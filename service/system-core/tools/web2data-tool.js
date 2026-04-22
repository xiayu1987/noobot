/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, stat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { chromium } from "playwright";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { z } from "zod";
import {
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
} from "../model/index.js";
import { mergeConfig } from "../config/index.js";
import { runWeb2Img } from "../utils/web2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";

const MAX_BATCH_BYTES = Math.floor(0.8 * 1024 * 1024);
const MAX_TEXT_CHARS = 12000;
const DIRECT_RETRY_COUNT = 2;
const DIRECT_RETRY_BACKOFF_MS = 1200;

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrl(input = "") {
  return /^https?:\/\//i.test(String(input || "").trim());
}

function normalizeHostName(urlValue = "") {
  try {
    return (
      String(new URL(urlValue).host || "").replace(/[^\w.-]+/g, "_") ||
      "unknown_host"
    );
  } catch {
    return "unknown_host";
  }
}

function normalizeStemFromUrl(urlValue = "") {
  const raw = String(urlValue || "").trim();
  const base = raw
    .replace(/^https?:\/\//i, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 120);
  const hash = createHash("md5").update(raw, "utf8").digest("hex").slice(0, 10);
  return base ? `${base}_${hash}` : hash;
}

function cleanAndDedupTextLines(input = "", maxLines = 4000) {
  const out = [];
  const seen = new Set();
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  for (const line of lines) {
    if (line.length <= 1) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= maxLines) break;
  }
  return out.join("\n");
}

function sleep(ms = 0) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(ms) || 0)),
  );
}

function looksBlockedPage({ status = 0, title = "", html = "", text = "" }) {
  if (Number(status) >= 500) return true;
  const sample = `${title}\n${text}\n${html}`.toLowerCase();
  const patterns = [
    "503 service temporarily unavailable",
    "service temporarily unavailable",
    "openresty",
    "access denied",
    "forbidden",
    "verification required",
    "captcha",
    "robot check",
    "安全验证",
    "访问受限",
    "请求过于频繁",
  ];
  return patterns.some((p) => sample.includes(p));
}

async function loadUrlsFromInputValue(inputValue = "") {
  const v = String(inputValue || "").trim();
  if (!v) return [];
  if (isUrl(v)) return [v];
  const st = await stat(v).catch(() => null);
  if (!st) return [];
  if (st.isFile()) {
    const txt = await readFile(v, "utf-8");
    return txt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#") && isUrl(s));
  }
  if (st.isDirectory()) {
    const files = (await readdir(v)).filter((name) =>
      name.toLowerCase().endsWith(".txt"),
    );
    const urls = [];
    for (const fileName of files) {
      const txt = await readFile(path.join(v, fileName), "utf-8");
      urls.push(
        ...txt
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#") && isUrl(s)),
      );
    }
    return urls;
  }
  return [];
}

function extractReadableTextFromHtml(html = "", urlValue = "") {
  try {
    const dom = new JSDOM(String(html || ""), {
      url: urlValue || "https://example.com/",
    });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    return normalizeText(parsed?.textContent || "");
  } catch {
    return "";
  }
}

async function runDirectWebExtract({ input = "", outputDir = "" }) {
  const urls = await loadUrlsFromInputValue(input);
  if (!urls.length) {
    throw new Error("未找到可处理的 URL");
  }
  await mkdir(outputDir, { recursive: true });

  const headless = true;
  const retryCount = DIRECT_RETRY_COUNT;
  const retryBackoffMs = DIRECT_RETRY_BACKOFF_MS;

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const results = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 2000 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "zh-CN",
      extraHTTPHeaders: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    try {
      for (const url of urls) {
        const hostDir = path.resolve(
          outputDir,
          `web_${normalizeHostName(url)}`,
        );
        await mkdir(hostDir, { recursive: true });
        const stem = normalizeStemFromUrl(url);
        const usefulTextPath = path.resolve(hostDir, `${stem}_useful.txt`);
        const fullTextPath = path.resolve(hostDir, `${stem}_full.txt`);
        const page = await context.newPage();
        try {
          let pageTitle = "";
          let html = "";
          let bodyInnerText = "";
          let finalStatus = 0;
          let success = false;

          for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
            const response = await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 45000,
            });
            finalStatus = Number(response?.status?.() || 0);
            try {
              await page.waitForLoadState("networkidle", { timeout: 10000 });
            } catch {
              // ignore
            }
            pageTitle = normalizeText(await page.title());
            html = await page.content();
            bodyInnerText = await page.evaluate(
              () => document.body?.innerText || "",
            );

            const blocked = looksBlockedPage({
              status: finalStatus,
              title: pageTitle,
              html,
              text: bodyInnerText,
            });
            if (!blocked) {
              success = true;
              break;
            }
            if (attempt <= retryCount) {
              await sleep(retryBackoffMs * attempt);
              continue;
            }
          }
          if (!success) {
            throw new Error(
              `访问被拦截或服务不可用(status=${finalStatus || 0})`,
            );
          }

          const readableText = extractReadableTextFromHtml(html, url);
          const fullText = cleanAndDedupTextLines(bodyInnerText, 10000);
          const usefulMerged = cleanAndDedupTextLines(
            `${pageTitle ? `# ${pageTitle}\n` : ""}${readableText || fullText}`,
            4000,
          );

          await writeFile(
            usefulTextPath,
            `URL: ${url}\n\n${usefulMerged}\n`,
            "utf-8",
          );
          await writeFile(
            fullTextPath,
            `URL: ${url}\n\n${fullText}\n`,
            "utf-8",
          );

          results.push({
            url,
            host_dir: hostDir,
            raw_image_path: "",
            image_paths: [],
            useful_text_path: usefulTextPath,
            full_text_path: fullTextPath,
            status: "ok",
            mode: "direct",
            retryCount,
          });
        } catch (error) {
          results.push({
            url,
            host_dir: hostDir,
            raw_image_path: "",
            image_paths: [],
            useful_text_path: "",
            full_text_path: "",
            status: "error",
            mode: "direct",
            retryCount,
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

  const indexPath = path.resolve(outputDir, "web_result.json");
  await writeFile(indexPath, JSON.stringify(results, null, 2), "utf-8");
  return { indexPath, results };
}

function resolveAttachmentImageAlias({ globalConfig, userConfig }) {
  return (
    userConfig?.attachmentModels?.image ||
    globalConfig?.attachmentModels?.image ||
    ""
  );
}

async function toDataUrl(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "application/octet-stream";
  const b64 = (await readFile(imagePath)).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function buildImageBatches(imagePaths = []) {
  const items = [];
  for (let idx = 0; idx < imagePaths.length; idx += 1) {
    const imagePath = imagePaths[idx];
    const st = await stat(imagePath);
    items.push({
      imagePath,
      sizeBytes: Number(st?.size || 0),
      dataUrl: await toDataUrl(imagePath),
    });
  }

  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const item of items) {
    if (current.length > 0 && currentBytes + item.sizeBytes > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [item];
      currentBytes = item.sizeBytes;
      continue;
    }
    current.push(item);
    currentBytes += item.sizeBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

function truncateText(input = "", maxChars = MAX_TEXT_CHARS) {
  const text = String(input || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[文本过长，已截断]`;
}

function toModelText(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

async function collectUsefulTextParts(okItems = []) {
  const out = [];
  for (const item of okItems) {
    const usefulPath = String(item?.useful_text_path || "").trim();
    if (!usefulPath) continue;
    try {
      const txt = await readFile(usefulPath, "utf8");
      out.push(`## ${item?.url || ""}\n${txt}`);
    } catch {
      // ignore one failed text file
    }
  }
  return out;
}

function normalizeProcessMode(value = "") {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return mode === "direct" || mode === "multimodal" ? mode : "direct";
}

async function resolveWebInput({ input = "", agentContext }) {
  const normalized = String(input || "").trim();
  if (!normalized) return "";
  if (isUrl(normalized)) return normalized;
  return assertAndResolveUserWorkspaceFilePath({
    filePath: normalized,
    agentContext,
    fieldName: "input",
    mustExist: true,
  });
}

export async function runWebToDataPipeline({
  agentContext,
  input = "",
  prompt = "",
  useTrafilatura = true,
  processMode = "",
}) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) {
    return {
      ok: false,
      message: "runtime basePath missing",
    };
  }

  const resolvedInput = await resolveWebInput({ input, agentContext });
  const outputRoot = path.join(
    basePath,
    "runtime",
    "workspace",
    ".web2data",
    randomUUID(),
  );
  await mkdir(outputRoot, { recursive: true });

  const effectiveMode = normalizeProcessMode(processMode);

  const webResult =
    effectiveMode === "multimodal"
      ? await runWeb2Img({
          input: resolvedInput,
          outputDir: outputRoot,
          useTrafilatura: useTrafilatura !== false,
        })
      : await runDirectWebExtract({
          input: resolvedInput,
          outputDir: outputRoot,
        });

  const okItems = (webResult.results || []).filter(
    (item) => String(item?.status || "") === "ok",
  );
  if (!okItems.length) {
    return {
      ok: false,
      message: "web_to_data no successful result",
      input: resolvedInput,
      outputRoot,
      indexPath: webResult.indexPath,
      results: webResult.results || [],
    };
  }

  const imagePaths = okItems.flatMap((item) =>
    Array.isArray(item?.image_paths) ? item.image_paths : [],
  );
  const usefulTextParts = await collectUsefulTextParts(okItems);

  const imageAlias = resolveAttachmentImageAlias({ globalConfig, userConfig });
  const modelSpec =
    imagePaths.length > 0
      ? resolveModelSpecByAlias({
          alias: imageAlias,
          globalConfig,
          userConfig,
          fallbackToDefault: true,
        })
      : resolveDefaultModelSpec({ globalConfig, userConfig });
  const llm = createChatModelByName(modelSpec?.alias || modelSpec?.model, {
    globalConfig,
    userConfig,
    streaming: false,
  });
  const userPrompt =
    prompt ||
    "请基于截图与文本提取网页核心信息：主题、关键事实、数据点、结论、代码片段（若有），并按清晰结构输出。";
  const sharedText = truncateText(usefulTextParts.join("\n\n"));

  const batchResults = [];
  if (imagePaths.length > 0) {
    const batches = await buildImageBatches(imagePaths);
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      const message = new HumanMessage({
        content: [
          {
            type: "text",
            text: `${userPrompt}\n\n这是第 ${i + 1} 批网页截图。\n\n网页文本参考：\n${sharedText}`,
          },
          ...batch.map((img) => ({
            type: "image_url",
            image_url: { url: img.dataUrl },
          })),
        ],
      });
      const res = await llm.invoke([message]);
      const text = toModelText(res?.content);
      batchResults.push({
        batch: i + 1,
        imageCount: batch.length,
        totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
        imagePaths: batch.map((x) => x.imagePath),
        text,
      });
    }
  } else {
    const res = await llm.invoke([
      new HumanMessage({
        content: `${userPrompt}\n\n网页文本参考：\n${sharedText}`,
      }),
    ]);
    const text = toModelText(res?.content);
    batchResults.push({
      batch: 1,
      imageCount: 0,
      totalBytes: 0,
      imagePaths: [],
      text,
    });
  }

  return {
    ok: true,
    mode: effectiveMode,
    input: resolvedInput,
    outputRoot,
    indexPath: webResult.indexPath,
    resultCount: webResult.results.length,
    successCount: okItems.length,
    imageCount: imagePaths.length,
    batchCount: batchResults.length,
    batches: batchResults,
    text: batchResults.map((x) => x.text).join("\n\n"),
    model: {
      alias: modelSpec?.alias || "",
      name: modelSpec?.model || "",
    },
  };
}

export function createWeb2DataTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const processMode = normalizeProcessMode(
    effectiveConfig?.tools?.web_to_data?.processMode,
  );
  if (!basePath) return [];

  const webToDataTool = new DynamicStructuredTool({
    name: "web_to_data",
    description:
      "网页解析并提取内容。调用 web2img 先抓取网页截图/文本，再交给大模型抽取结构化信息。input 支持 URL 或工作区内 .txt 列表文件路径。",
    schema: z.object({
      input: z
        .string()
        .describe("URL 或工作区内 txt 文件路径（可包含多行 URL）"),
      prompt: z
        .string()
        .optional()
        .describe("默认提取网页核心事实并按条目输出"),
      useTrafilatura: z
        .boolean()
        .optional()
        .describe("是否优先使用 Readability 提取正文，默认 true"),
    }),
    func: async ({ input, prompt, useTrafilatura }) => {
      const payload = await runWebToDataPipeline({
        agentContext,
        input,
        prompt,
        useTrafilatura: useTrafilatura !== false,
        processMode,
      });
      return toToolJsonResult("web_to_data", payload, true);
    },
  });

  return [webToDataTool];
}
