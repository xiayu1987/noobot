/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { z } from "zod";
import {
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import { mergeConfig } from "../config/index.js";
import { runWebToDataPipeline } from "./web2data-tool.js";
import { toToolJsonResult } from "./tool-json-result.js";

const SEARCH_ENGINES = {
  baidu: {
    name: "baidu",
    buildUrl: (query) =>
      `https://www.baidu.com/s?wd=${encodeURIComponent(String(query || ""))}`,
  },
  google: {
    name: "google",
    buildUrl: (query) =>
      `https://www.google.com/search?q=${encodeURIComponent(String(query || ""))}&hl=zh-CN`,
  },
};

function normalizeText(v = "") {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function isLikelyWebHref(href = "") {
  const x = String(href || "").trim();
  if (!x) return false;
  if (x.startsWith("#")) return false;
  if (/^(javascript|mailto|tel):/i.test(x)) return false;
  return true;
}

function tryDecodeUrlComponent(value = "") {
  let cur = String(value || "");
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

function extractEmbeddedUrl(value = "", baseUrl = "") {
  const src = normalizeText(value);
  if (!src) return "";
  const decoded = tryDecodeUrlComponent(src);
  const candidates = [src, decoded];

  for (const item of candidates) {
    if (/^https?:\/\//i.test(item)) return item;
    if (item.startsWith("//")) return `https:${item}`;
  }

  for (const item of candidates) {
    try {
      const u = new URL(item, baseUrl);
      for (const key of ["target", "url", "u", "q", "dest", "destination", "to", "redirect"]) {
        const val = normalizeText(u.searchParams.get(key) || "");
        if (/^https?:\/\//i.test(val)) return tryDecodeUrlComponent(val);
      }
    } catch {
      // ignore
    }
  }

  for (const item of candidates) {
    const m = item.match(/https?:\/\/[^\s"'<>]+/i);
    if (m?.[0]) return m[0];
  }
  return "";
}

function isSearchEngineHost(urlValue = "") {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return (
      host.endsWith("baidu.com") ||
      host.endsWith("google.com") ||
      host.endsWith("bing.com") ||
      host.endsWith("so.com") ||
      host.endsWith("sogou.com")
    );
  } catch {
    return false;
  }
}

function collectAnchorPossibleUrls(a, baseUrl = "") {
  const out = [];
  const push = (v) => {
    const u = extractEmbeddedUrl(v, baseUrl);
    if (!u || !/^https?:\/\//i.test(u)) return;
    if (!out.includes(u)) out.push(u);
  };

  push(a.getAttribute("href") || "");
  for (const attr of ["data-landurl", "data-url", "mu", "m", "url", "ping"]) {
    push(a.getAttribute(attr) || "");
  }
  const dataLog = a.getAttribute("data-log") || "";
  if (dataLog) {
    try {
      const parsed = JSON.parse(dataLog);
      push(parsed?.mu || "");
      push(parsed?.url || "");
      push(parsed?.target || "");
    } catch {
      push(dataLog);
    }
  }
  return out;
}

function pickBestAnchorUrl(urls = []) {
  if (!urls.length) return "";
  const direct = urls.find((u) => !isSearchEngineHost(u));
  return direct || urls[0];
}

async function loadSearchHtmlByBrowser(page, searchUrl = "") {
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(500);
  return await page.content();
}

function extractAnchorCandidates({ html = "", searchUrl = "", engineName = "" }) {
  const dom = new JSDOM(String(html || ""));
  const doc = dom.window.document;
  const links = Array.from(doc.querySelectorAll("a"));
  const out = [];
  const dedup = new Set();

  for (const a of links) {
    const rawHref = normalizeText(a.getAttribute("href") || "");
    if (!isLikelyWebHref(rawHref)) continue;
    const possibleUrls = collectAnchorPossibleUrls(a, searchUrl);
    const href = pickBestAnchorUrl(possibleUrls);
    if (!/^https?:\/\//i.test(href)) continue;
    if (href.length > 2048) continue;

    const text = normalizeText(a.textContent || "");
    const title = normalizeText(a.getAttribute("title") || "");
    const ariaLabel = normalizeText(a.getAttribute("aria-label") || "");
    const innerHtml = normalizeText(a.innerHTML || "").slice(0, 300);
    const mergedText = normalizeText([text, title, ariaLabel].filter(Boolean).join(" "));
    const hasReadableContent = Boolean(mergedText || innerHtml);
    if (!hasReadableContent) continue;

    const dedupKey = `${href}__${mergedText || innerHtml.slice(0, 120)}`;
    if (dedup.has(dedupKey)) continue;
    dedup.add(dedupKey);

    out.push({
      engine: engineName,
      href,
      possibleUrls,
      text,
      title,
      ariaLabel,
      innerHtml,
      mergedText,
    });
  }
  return out;
}

function extractJsonValue(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}

  const patterns = [/\{[\s\S]*\}/, /\[[\s\S]*\]/];
  for (const p of patterns) {
    const matched = text.match(p);
    if (!matched?.[0]) continue;
    try {
      return JSON.parse(matched[0]);
    } catch {}
  }
  return null;
}

function pickIndexesFromModelOutput(parsed, maxIdx) {
  const values = [];
  if (Array.isArray(parsed)) values.push(...parsed);
  if (parsed && typeof parsed === "object") {
    const arr =
      parsed.selectedIndexes ||
      parsed.indexes ||
      parsed.selected ||
      parsed.links ||
      [];
    if (Array.isArray(arr)) values.push(...arr);
  }
  const uniq = [];
  for (const x of values) {
    const n = Number(x);
    if (!Number.isFinite(n)) continue;
    const idx = Math.floor(n);
    if (idx < 1 || idx > maxIdx) continue;
    if (!uniq.includes(idx)) uniq.push(idx);
  }
  return uniq;
}

function fallbackSelectCandidates({ query = "", candidates = [], topK = 3 }) {
  const qWords = normalizeText(query)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const scored = candidates.map((item, i) => {
    const text = `${item?.mergedText || ""} ${item?.href || ""}`.toLowerCase();
    let score = 0;
    for (const q of qWords) {
      if (text.includes(q)) score += 2;
      if (String(item?.href || "").toLowerCase().includes(q)) score += 1;
    }
    score += Math.min(2, Math.floor((item?.text || "").length / 20));
    return { idx: i + 1, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK)).map((x) => x.idx);
}

async function resolveFinalUrl(inputUrl = "") {
  const normalized = normalizeText(inputUrl);
  if (!/^https?:\/\//i.test(normalized)) return normalized;
  const embedded = extractEmbeddedUrl(normalized, normalized);
  if (embedded && embedded !== normalized) return embedded;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const commonHeaders = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    try {
      const headRes = await fetch(normalized, {
        method: "HEAD",
        redirect: "follow",
        headers: commonHeaders,
        signal: controller.signal,
      });
      const resolved = normalizeText(headRes?.url || "");
      if (/^https?:\/\//i.test(resolved)) return resolved;
    } catch {
      // ignore HEAD fallback to GET
    }
    const getRes = await fetch(normalized, {
      method: "GET",
      redirect: "follow",
      headers: commonHeaders,
      signal: controller.signal,
    });
    const resolved = normalizeText(getRes?.url || "");
    return /^https?:\/\//i.test(resolved) ? resolved : normalized;
  } catch {
    return normalized;
  } finally {
    clearTimeout(timer);
  }
}

async function selectCandidatesByModel({
  query,
  candidates,
  topK,
  modelName,
  globalConfig,
  userConfig,
}) {
  const modelSpec = resolveModelSpecByName({
    modelName,
    globalConfig,
    userConfig,
    fallbackToDefault: true,
  });
  const llm = createChatModelByName(modelSpec?.alias || modelSpec?.model, {
    globalConfig,
    userConfig,
    streaming: false,
  });
  const compact = candidates.map((item, idx) => ({
    index: idx + 1,
    engine: item.engine,
    href: item.href,
    text: item.mergedText.slice(0, 300),
    innerHtml: item.innerHtml.slice(0, 180),
  }));

  const prompt = [
    "你是链接筛选器。",
    `用户查询：${query}`,
    `请从候选链接中选出最符合查询意图的 ${topK} 个链接。`,
    "只输出 JSON，不要输出其他文字。",
    '格式：{"selectedIndexes":[1,2],"reason":"可选"}',
    `候选列表：\n${JSON.stringify(compact, null, 2)}`,
  ].join("\n\n");

  const res = await llm.invoke([new HumanMessage({ content: prompt })]);
  const raw =
    typeof res?.content === "string"
      ? res.content
      : JSON.stringify(res?.content || "");
  const parsed = extractJsonValue(raw);
  const indexes = pickIndexesFromModelOutput(parsed, candidates.length);
  if (!indexes.length) {
    return {
      indexes: fallbackSelectCandidates({ query, candidates, topK }),
      model: modelSpec,
      raw,
      usedFallback: true,
    };
  }
  return {
    indexes: indexes.slice(0, Math.max(1, topK)),
    model: modelSpec,
    raw,
    usedFallback: false,
  };
}

export function createWebSearchTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig || {}, userConfig || {});
  const webSearchProcessMode = String(
    effectiveConfig?.tools?.web_search_to_data?.processMode || "",
  )
    .trim()
    .toLowerCase();
  const basePath = String(agentContext?.basePath || runtime?.basePath || "").trim();
  if (!basePath) return [];

  const webSearchToDataTool = new DynamicStructuredTool({
    name: "web_search_to_data",
    description:
      "网页搜索并解析：先通过 Baidu/Google 搜索，提取搜索结果页链接，再由大模型筛选最符合链接，最后调用网页解析流程输出结果。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      engines: z
        .array(z.enum(["baidu", "google"]))
        .optional()
        .describe("搜索引擎列表，默认 [baidu, google]"),
      maxCandidates: z
        .number()
        .int()
        .positive()
        .max(60)
        .optional()
        .describe("最多候选链接数，默认 60，最大 60"),
      topK: z
        .number()
        .int()
        .positive()
        .max(3)
        .optional()
        .describe("筛选后解析的链接数量，默认 3，最大 3"),
      modelName: z
        .string()
        .optional()
        .describe("可选：筛选链接使用的模型别名或模型名"),
      prompt: z
        .string()
        .optional()
        .describe("网页解析提示词，透传给 web_to_data 流程"),
      useTrafilatura: z
        .boolean()
        .optional()
        .describe("网页解析是否优先使用 Readability，默认 true"),
    }),
    func: async ({
      query,
      engines = ["baidu", "google"],
      maxCandidates = 60,
      topK = 3,
      modelName = "",
      prompt = "",
      useTrafilatura = true,
    }) => {
      const normalizedQuery = normalizeText(query);
      if (!normalizedQuery) {
        return toToolJsonResult("web_search_to_data", {
          ok: false,
          error: "query required",
        });
      }
      const engineList = Array.from(
        new Set(
          (Array.isArray(engines) ? engines : [])
            .map((x) => String(x || "").trim().toLowerCase())
            .filter((x) => Boolean(SEARCH_ENGINES[x])),
        ),
      );
      const effectiveEngines = engineList.length ? engineList : ["baidu", "google"];
      const finalMaxCandidates = Math.min(
        60,
        Math.max(1, Number(maxCandidates) || 60),
      );
      const allCandidates = [];
      const searchRequests = [];
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1366, height: 900 },
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          ignoreHTTPSErrors: true,
        });
        try {
          for (const engineName of effectiveEngines) {
            const engine = SEARCH_ENGINES[engineName];
            const searchUrl = engine.buildUrl(normalizedQuery);
            const page = await context.newPage();
            try {
              const html = await loadSearchHtmlByBrowser(page, searchUrl);
              const extracted = extractAnchorCandidates({
                html,
                searchUrl,
                engineName,
              });
              const extractedLimited = extracted.slice(0, finalMaxCandidates);
              allCandidates.push(...extractedLimited);
              searchRequests.push({
                engine: engineName,
                url: searchUrl,
                ok: true,
                status: 200,
                rawCandidateCount: extracted.length,
                candidateCount: extractedLimited.length,
              });
            } catch (error) {
              searchRequests.push({
                engine: engineName,
                url: searchUrl,
                ok: false,
                status: 0,
                candidateCount: 0,
                error: error?.message || String(error),
              });
            } finally {
              await page.close().catch(() => {});
            }
          }
        } finally {
          await context.close().catch(() => {});
        }
      } finally {
        await browser.close().catch(() => {});
      }

      const dedupMap = new Map();
      for (const item of allCandidates) {
        const key = `${item.href}__${item.mergedText}`.slice(0, 1000);
        if (!dedupMap.has(key)) dedupMap.set(key, item);
      }
      const dedupCandidates = Array.from(dedupMap.values()).slice(
        0,
        finalMaxCandidates,
      );
      if (!dedupCandidates.length) {
        return toToolJsonResult("web_search_to_data", {
          ok: false,
          query: normalizedQuery,
          searchRequests,
          error: "no candidate links extracted",
        });
      }

      const finalTopK = Math.min(3, Math.max(1, Number(topK) || 3));
      const selection = await selectCandidatesByModel({
        query: normalizedQuery,
        candidates: dedupCandidates,
        topK: finalTopK,
        modelName: String(modelName || "").trim(),
        globalConfig,
        userConfig,
      });

      const selectedLinks = selection.indexes
        .map((idx) => dedupCandidates[idx - 1])
        .filter(Boolean);
      const parsedPages = [];
      for (const item of selectedLinks) {
        try {
          const resolvedHref = await resolveFinalUrl(item.href);
          const parsed = await runWebToDataPipeline({
            agentContext,
            input: resolvedHref,
            prompt,
            useTrafilatura: useTrafilatura !== false,
            processMode: webSearchProcessMode,
          });
          parsedPages.push({
            href: item.href,
            resolvedHref,
            engine: item.engine,
            ok: parsed?.ok === true,
            result: parsed,
          });
        } catch (error) {
          parsedPages.push({
            href: item.href,
            resolvedHref: item.href,
            engine: item.engine,
            ok: false,
            error: error?.message || String(error),
          });
        }
      }

      const defaultModel = resolveDefaultModelSpec({ globalConfig, userConfig });
      return toToolJsonResult(
        "web_search_to_data",
        {
          ok: true,
          query: normalizedQuery,
          searchRequests,
          candidateCount: dedupCandidates.length,
          candidates: dedupCandidates,
          selectedIndexes: selection.indexes,
          selectedLinks,
          selectionModel: {
            alias: selection?.model?.alias || defaultModel?.alias || "",
            name: selection?.model?.model || defaultModel?.model || "",
            usedFallback: selection.usedFallback === true,
          },
          selectionRaw: selection.raw || "",
          parsedPages,
          successCount: parsedPages.filter((x) => x.ok).length,
          text: parsedPages
            .filter((x) => x.ok && x?.result?.text)
            .map((x) => `# ${x.href}\n${x.result.text}`)
            .join("\n\n"),
        },
        true,
      );
    },
  });

  return [webSearchToDataTool];
}
