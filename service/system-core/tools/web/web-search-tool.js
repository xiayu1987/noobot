/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { JSDOM } from "jsdom";
import { z } from "zod";
import {
  createChatModelByName,
  resolveModelSpecByName,
} from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { runWebToDataPipeline } from "./web-to-data-pipeline.js";
import { toToolJsonResult } from "../tool-json-result.js";
import { browseUrlHtml } from "./web-browser-simulate.js";
import { browserLikeFetch } from "./web-fetch.js";

const DEFAULT_ENGINES = ["google", "bing", "sogou", "so", "duckduckgo", "yahoo"];
const SEARCH_ENGINE_HOST_SUFFIXES = [
  "google.com",
  "bing.com",
  "so.com",
  "sogou.com",
  "duckduckgo.com",
  "yahoo.com",
];

const SEARCH_ENGINES = {
  google: {
    name: "google",
    buildUrl: (query) =>
      `https://www.google.com/search?q=${encodeURIComponent(String(query || ""))}&hl=zh-CN`,
  },
  bing: {
    name: "bing",
    buildUrl: (query) =>
      `https://cn.bing.com/search?q=${encodeURIComponent(String(query || ""))}`,
  },
  sogou: {
    name: "sogou",
    buildUrl: (query) =>
      `https://www.sogou.com/web?query=${encodeURIComponent(String(query || ""))}`,
  },
  so: {
    name: "so",
    buildUrl: (query) =>
      `https://www.so.com/s?q=${encodeURIComponent(String(query || ""))}`,
  },
  duckduckgo: {
    name: "duckduckgo",
    buildUrl: (query) =>
      `https://duckduckgo.com/?q=${encodeURIComponent(String(query || ""))}`,
  },
  yahoo: {
    name: "yahoo",
    buildUrl: (query) =>
      `https://search.yahoo.com/search?p=${encodeURIComponent(String(query || ""))}`,
  },
};

function normalizeText(v = "") {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function pickHost(urlValue = "") {
  try {
    return String(new URL(String(urlValue || "")).host || "").toLowerCase();
  } catch {
    return "";
  }
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
    return SEARCH_ENGINE_HOST_SUFFIXES.some((suffix) =>
      host.endsWith(suffix),
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

function normalizeSearchMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "browser_simulate" || mode === "browser-simulate" || mode === "browser"
    ? "browser_simulate"
    : "direct";
}

function normalizeWebProcessMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "multimodal") return "multimodal";
  return mode === "browser_simulate" || mode === "browser-simulate" || mode === "browser"
    ? "browser_simulate"
    : "direct";
}

async function loadSearchHtmlDirect(searchUrl = "") {
  const res = await browserLikeFetch(searchUrl, { method: "GET" });
  return {
    html: await res.text(),
    ok: res.ok,
    status: res.status,
  };
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
    try {
      const headRes = await browserLikeFetch(normalized, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      const resolved = normalizeText(headRes?.url || "");
      if (/^https?:\/\//i.test(resolved)) return resolved;
    } catch {
      // ignore HEAD fallback to GET
    }
    const getRes = await browserLikeFetch(normalized, {
      method: "GET",
      redirect: "follow",
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
  const webSearchMode = normalizeSearchMode(
    effectiveConfig?.tools?.web_search_to_data?.searchMode || "",
  );
  const webProcessMode = normalizeWebProcessMode(
    effectiveConfig?.tools?.web_search_to_data?.switchWebMode || "",
  );
  const configMaxCandidates = Math.min(
    30,
    Math.max(
      1,
      Number(effectiveConfig?.tools?.web_search_to_data?.maxCandidates) || 30,
    ),
  );
  const configTopK = Math.min(
    10,
    Math.max(1, Number(effectiveConfig?.tools?.web_search_to_data?.topK) || 10),
  );
  const basePath = String(agentContext?.basePath || runtime?.basePath || "").trim();
  if (!basePath) return [];

  const webSearchToDataTool = new DynamicStructuredTool({
    name: "web_search_to_data",
    description:
      "网页搜索并解析：先通过 Google/Bing/Sogou/360/DuckDuckGo/Yahoo 搜索，提取搜索结果页链接，再由大模型筛选最符合链接，最后调用网页解析流程输出结果。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      engines: z
        .array(
          z.enum(["google", "bing", "sogou", "so", "duckduckgo", "yahoo"]),
        )
        .optional()
        .describe(
          `搜索引擎列表，默认 [${DEFAULT_ENGINES.join(", ")}]`,
        ),
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
      engines = DEFAULT_ENGINES,
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
      const effectiveEngines = engineList.length
        ? engineList
        : DEFAULT_ENGINES;
      const finalMaxCandidates = Math.min(
        30,
        Math.max(1, Number(configMaxCandidates) || 30),
      );
      const engineResults = await Promise.all(
        effectiveEngines.map(async (engineName) => {
          const engine = SEARCH_ENGINES[engineName];
          const searchUrl = engine.buildUrl(normalizedQuery);
          try {
            const loaded =
              webSearchMode === "browser_simulate"
                ? await browseUrlHtml({
                    url: searchUrl,
                    waitUntil: "domcontentloaded",
                    timeout: 30000,
                    networkIdleTimeout: 5000,
                  })
                : await loadSearchHtmlDirect(searchUrl);
            if (webSearchMode === "browser_simulate" && !loaded?.ok) {
              throw new Error(loaded?.error || "load failed");
            }
            const extracted = extractAnchorCandidates({
              html: loaded?.html || "",
              searchUrl,
              engineName,
            });
            const extractedLimited = extracted.slice(0, finalMaxCandidates);
            return {
              candidates: extractedLimited,
              request: {
                engine: engineName,
                url: searchUrl,
                ok:
                  webSearchMode === "browser_simulate"
                    ? true
                    : Boolean(loaded?.ok),
                status:
                  webSearchMode === "browser_simulate"
                    ? Number(loaded?.status || 200)
                    : Number(loaded?.status || 0),
                rawCandidateCount: extracted.length,
                candidateCount: extractedLimited.length,
              },
            };
          } catch (error) {
            return {
              candidates: [],
              request: {
                engine: engineName,
                url: searchUrl,
                ok: false,
                status: 0,
                candidateCount: 0,
                error: error?.message || String(error),
              },
            };
          }
        }),
      );
      const searchRequests = engineResults.map((x) => x.request);
      const allCandidates = engineResults.flatMap((x) => x.candidates);

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
        const searchDomains = Array.from(
          new Set(
            searchRequests
              .map((item) => pickHost(item?.url || ""))
              .filter(Boolean),
          ),
        );
        return toToolJsonResult("web_search_to_data", {
          ok: false,
          searchDomains,
          result: {
            error: "no candidate links extracted",
          },
        });
      }

      const finalTopK = Math.min(10, Math.max(1, Number(configTopK) || 10));
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
      const selectedResolvedUrls = await Promise.all(
        selectedLinks.map((item) => resolveFinalUrl(item.href)),
      );
      const parsed = await runWebToDataPipeline({
        agentContext,
        urls: selectedResolvedUrls,
        prompt,
        useTrafilatura: useTrafilatura !== false,
        processMode: webProcessMode,
      });

      const searchDomains = Array.from(
        new Set(
          searchRequests
            .map((item) => pickHost(item?.url || ""))
            .filter(Boolean),
        ),
      );
      return toToolJsonResult(
        "web_search_to_data",
        {
          ok: true,
          searchDomains,
          text: String(parsed?.text || ""),
        },
        true,
      );
    },
  });

  return [webSearchToDataTool];
}
