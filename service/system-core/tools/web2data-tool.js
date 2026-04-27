/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, stat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import {
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
} from "../model/index.js";
import { runWeb2Img } from "../utils/web2img.js";
import { browseUrlHtml } from "../utils/web-browser-simulate.js";
import {
  cleanAndDedupTextLines,
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "../utils/web-text-cleaner.js";
import { browserLikeFetch } from "../utils/web-fetch.js";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";

const MAX_BATCH_BYTES = Math.floor(0.8 * 1024 * 1024);
const MAX_TEXT_CHARS = 12000;
const BROWSER_RETRY_COUNT = 2;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 60;

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isUrl(input = "") {
  return /^https?:\/\//i.test(String(input || "").trim());
}

function looksBlockedPage({ status = 0, title = "", html = "", text = "" }) {
  if (Number(status) >= 500) return true;
  const normalizedTitle = normalizeText(title).toLowerCase();
  const normalizedText = String(text || "").toLowerCase();
  const leadingTextSample = normalizedText.slice(0, 8000);
  const titleOrTextSample = `${normalizedTitle}\n${leadingTextSample}`;
  const strongPatterns = [
    "503 service temporarily unavailable",
    "service temporarily unavailable",
    "openresty",
    "access denied",
    "403 forbidden",
    "verification required",
    "robot check",
    "安全验证",
    "访问受限",
    "请求过于频繁",
  ];
  if (strongPatterns.some((patternText) => titleOrTextSample.includes(patternText))) {
    return true;
  }

  // “captcha” 在很多正常页面的脚本配置里会出现，不应单独作为拦截信号
  const hasCaptchaSignal = /captcha|hcaptcha|recaptcha/i.test(
    `${normalizedTitle}\n${leadingTextSample}`,
  );
  const hasChallengeSignal = /verification required|robot check|安全验证|请完成验证|访问受限/i.test(
    `${normalizedTitle}\n${leadingTextSample}`,
  );
  if (hasCaptchaSignal && hasChallengeSignal) return true;

  // 仅在正文很短且包含拦截特征时，才用 html 兜底判定
  if (leadingTextSample.length < 500) {
    const normalizedHtml = String(html || "").toLowerCase().slice(0, 20000);
    if (
      /openresty|access denied|403 forbidden|service temporarily unavailable/.test(
        normalizedHtml,
      )
    ) {
      return true;
    }
  }

  return false;
}

function normalizeProcessMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "multimodal") return "multimodal";
  if (
    mode === "browser_simulate" ||
    mode === "browser-simulate" ||
    mode === "browser"
  ) {
    return "browser_simulate";
  }
  return "direct";
}

function toModelText(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

function truncateText(input = "", maxChars = MAX_TEXT_CHARS) {
  const text = String(input || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[文本过长，已截断]`;
}

function uniqueUrls(urls = []) {
  return Array.from(
    new Set(
      (urls || [])
        .map((urlValue) => String(urlValue || "").trim())
        .filter((urlValue) => isUrl(urlValue)),
    ),
  );
}

function normalizeConcurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(num)));
}

function resolveFetcher(runtime = {}) {
  const contextFetcher = runtime?.sharedTools?.fetch;
  return typeof contextFetcher === "function" ? contextFetcher : browserLikeFetch;
}

async function mapWithConcurrency(items = [], worker, concurrency = DEFAULT_CONCURRENCY) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const size = normalizeConcurrency(concurrency);
  const results = new Array(list.length);
  let cursor = 0;
  async function runOne() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(size, list.length) }, () =>
    runOne(),
  );
  await Promise.all(workers);
  return results;
}

async function loadUrlsFromInputValue(inputValue = "") {
  const normalizedInputValue = String(inputValue || "").trim();
  if (!normalizedInputValue) return [];
  if (isUrl(normalizedInputValue)) return [normalizedInputValue];
  const statResult = await stat(normalizedInputValue).catch(() => null);
  if (!statResult) return [];
  if (statResult.isFile()) {
    const textContent = await readFile(normalizedInputValue, "utf-8");
    return textContent
      .split(/\r?\n/)
      .map((lineText) => lineText.trim())
      .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText));
  }
  if (statResult.isDirectory()) {
    const files = (await readdir(normalizedInputValue)).filter((name) =>
      name.toLowerCase().endsWith(".txt"),
    );
    const urls = [];
    for (const fileName of files) {
      const textContent = await readFile(path.join(normalizedInputValue, fileName), "utf-8");
      urls.push(
        ...textContent
          .split(/\r?\n/)
          .map((lineText) => lineText.trim())
          .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText)),
      );
    }
    return urls;
  }
  return [];
}

async function resolveInputUrls({ input = "", urls = [], agentContext }) {
  const byUrls = uniqueUrls(Array.isArray(urls) ? urls : []);
  if (byUrls.length) return byUrls;

  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) return [];
  if (isUrl(normalizedInput)) return [normalizedInput];

  const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
    filePath: normalizedInput,
    agentContext,
    fieldName: "input",
    mustExist: true,
  });
  return uniqueUrls(await loadUrlsFromInputValue(resolvedPath));
}

async function buildImageBatches(imagePaths = []) {
  const items = [];
  for (let idx = 0; idx < imagePaths.length; idx += 1) {
    const imagePath = imagePaths[idx];
    const st = await stat(imagePath);
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
    items.push({
      imagePath,
      sizeBytes: Number(st?.size || 0),
      dataUrl: `data:${mime};base64,${b64}`,
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

async function runDirectFetchExtract(
  urls = [],
  concurrency = DEFAULT_CONCURRENCY,
  runtimeContext = null,
) {
  const fetcher = resolveFetcher(runtimeContext || {});
  return mapWithConcurrency(
    urls,
    async (url) => {
      try {
        const res = await fetcher(url, { method: "GET" });
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageTitle = normalizeText(titleMatch?.[1] || "");
        const readableText = extractReadableTextFromHtml(html, url);
        const fullText = extractVisibleTextFromHtml(html);
        return {
          url,
          status: res.ok ? "ok" : "error",
          mode: "direct",
          title: pageTitle,
          usefulText: cleanAndDedupTextLines(
            `${pageTitle ? `# ${pageTitle}\n` : ""}${readableText || fullText}`,
            4000,
          ),
          fullText,
          error: res.ok ? "" : `http status ${res.status}`,
        };
      } catch (error) {
        return {
          url,
          status: "error",
          mode: "direct",
          title: "",
          usefulText: "",
          fullText: "",
          error: error?.message || String(error),
        };
      }
    },
    concurrency,
  );
}

async function runBrowserSimulateExtract(
  urls = [],
  concurrency = DEFAULT_CONCURRENCY,
  runtimeContext = null,
) {
  return mapWithConcurrency(
    urls,
    async (url) => {
      try {
        let loaded = null;
        let success = false;
        for (let attempt = 1; attempt <= BROWSER_RETRY_COUNT + 1; attempt += 1) {
          loaded = await browseUrlHtml({
            url,
            waitUntil: "domcontentloaded",
            timeout: 45000,
            networkIdleTimeout: 10000,
            runtimeContext,
          });
          const blocked = looksBlockedPage({
            status: Number(loaded?.status || 0),
            title: normalizeText(loaded?.title || ""),
            html: String(loaded?.html || ""),
            text: String(loaded?.text || ""),
          });
          if (loaded?.ok && !blocked) {
            success = true;
            break;
          }
        }
        if (!success || !loaded) {
          throw new Error(
            loaded?.error || `访问被拦截或服务不可用(status=${loaded?.status || 0})`,
          );
        }
        const pageTitle = normalizeText(loaded.title || "");
        const html = String(loaded.html || "");
        const bodyInnerText = String(loaded.text || "");
        const readableText = extractReadableTextFromHtml(html, url);
        const fullText = cleanAndDedupTextLines(bodyInnerText, 10000);
        return {
          url,
          status: "ok",
          mode: "browser_simulate",
          title: pageTitle,
          usefulText: cleanAndDedupTextLines(
            `${pageTitle ? `# ${pageTitle}\n` : ""}${readableText || fullText}`,
            4000,
          ),
          fullText,
          error: "",
        };
      } catch (error) {
        return {
          url,
          status: "error",
          mode: "browser_simulate",
          title: "",
          usefulText: "",
          fullText: "",
          error: error?.message || String(error),
        };
      }
    },
    concurrency,
  );
}

async function summarizeByModel({
  records = [],
  imagePaths = [],
  prompt = "",
  globalConfig = {},
  userConfig = {},
}) {
  const okRecords = records.filter((recordItem) => recordItem?.status === "ok");
  const usefulTextParts = okRecords.map(
    (recordItem) => `## ${recordItem?.url || ""}\n${recordItem?.usefulText || ""}`,
  );
  const imageAlias =
    userConfig?.attachments?.attachmentModels?.image ||
    userConfig?.attachments?.models?.image ||
    userConfig?.attachmentModels?.image ||
    globalConfig?.attachments?.attachmentModels?.image ||
    globalConfig?.attachments?.models?.image ||
    globalConfig?.attachmentModels?.image ||
    "";
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
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const modelResponse = await llm.invoke([
        new HumanMessage({
          content: [
            {
              type: "text",
              text: `${userPrompt}\n\n这是第 ${batchIndex + 1} 批网页截图。\n\n网页文本参考：\n${sharedText}`,
            },
            ...batch.map((imageItem) => ({
              type: "image_url",
              image_url: { url: imageItem.dataUrl },
            })),
          ],
        }),
      ]);
      batchResults.push({
        batch: batchIndex + 1,
        imageCount: batch.length,
        totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
        imagePaths: batch.map((imageItem) => imageItem.imagePath),
        text: toModelText(modelResponse?.content),
      });
    }
  } else {
    const modelResponse = await llm.invoke([
      new HumanMessage({
        content: `${userPrompt}\n\n网页文本参考：\n${sharedText}`,
      }),
    ]);
    batchResults.push({
      batch: 1,
      imageCount: 0,
      totalBytes: 0,
      imagePaths: [],
      text: toModelText(modelResponse?.content),
    });
  }

  return {
    batchResults,
    text: batchResults.map((batchResult) => batchResult.text).join("\n\n"),
    model: {
      alias: modelSpec?.alias || "",
      name: modelSpec?.model || "",
    },
  };
}

export async function runWebToDataPipeline({
  agentContext,
  input = "",
  urls = [],
  prompt = "",
  useTrafilatura = true,
  processMode = "",
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const runtime = getRuntime(agentContext);
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) {
    return { ok: false, message: "runtime basePath missing" };
  }

  const resolvedUrls = await resolveInputUrls({ input, urls, agentContext });
  if (!resolvedUrls.length) {
    return { ok: false, message: "未找到可处理的 URL", urls: [] };
  }

  const mode = normalizeProcessMode(processMode);
  const parallelism = normalizeConcurrency(concurrency);
  const outputRoot = path.join(
    basePath,
    "runtime",
    "workspace",
    ".web2data",
    randomUUID(),
  );

  if (mode === "multimodal") {
    await mkdir(outputRoot, { recursive: true });
    let multimodalInput = "";
    if (resolvedUrls.length === 1) {
      multimodalInput = resolvedUrls[0];
    } else {
      const inputFile = path.join(outputRoot, "urls.txt");
      await writeFile(inputFile, `${resolvedUrls.join("\n")}\n`, "utf-8");
      multimodalInput = inputFile;
    }
    const webResult = await runWeb2Img({
      input: multimodalInput,
      outputDir: outputRoot,
      useTrafilatura: useTrafilatura !== false,
    });
    const okItems = (webResult.results || []).filter(
      (item) => String(item?.status || "") === "ok",
    );
    if (!okItems.length) {
      return {
        ok: false,
        mode,
        message: "web_to_data no successful result",
        input,
        urls: resolvedUrls,
        outputRoot,
        indexPath: webResult.indexPath,
        results: webResult.results || [],
      };
    }
    const imagePaths = okItems.flatMap((item) =>
      Array.isArray(item?.image_paths) ? item.image_paths : [],
    );
    const records = [];
    for (const item of okItems) {
      let usefulText = "";
      let fullText = "";
      try {
        usefulText = await readFile(String(item?.useful_text_path || ""), "utf8");
      } catch {}
      try {
        fullText = await readFile(String(item?.full_text_path || ""), "utf8");
      } catch {}
      records.push({
        url: String(item?.url || ""),
        status: "ok",
        mode,
        usefulText,
        fullText,
        error: "",
      });
    }
    const summary = await summarizeByModel({
      records,
      imagePaths,
      prompt,
      globalConfig,
      userConfig,
    });
    return {
      ok: true,
      mode,
      input,
      urls: resolvedUrls,
      outputRoot,
      indexPath: webResult.indexPath,
      results: webResult.results || [],
      resultCount: (webResult.results || []).length,
      successCount: okItems.length,
      imageCount: imagePaths.length,
      batchCount: summary.batchResults.length,
      batches: summary.batchResults,
      text: summary.text,
      model: summary.model,
      records,
    };
  }

  const records =
    mode === "browser_simulate"
      ? await runBrowserSimulateExtract(resolvedUrls, parallelism, runtime)
      : await runDirectFetchExtract(resolvedUrls, parallelism, runtime);
  const successCount = records.filter((recordItem) => recordItem?.status === "ok").length;
  if (successCount <= 0) {
    const errorMessages = records
      .map((recordItem) =>
        recordItem?.status === "error"
          ? `${recordItem?.url || ""}: ${recordItem?.error || "unknown error"}`
          : "",
      )
      .filter(Boolean)
      .slice(0, 3);
    return {
      ok: false,
      mode,
      input,
      urls: resolvedUrls,
      resultCount: records.length,
      successCount: 0,
      imageCount: 0,
      batchCount: 0,
      batches: [],
      text: "",
      model: {},
      message: errorMessages.length
        ? `网页提取失败：${errorMessages.join(" | ")}`
        : "网页提取失败：没有可用结果",
      records,
    };
  }
  const summary = await summarizeByModel({
    records,
    imagePaths: [],
    prompt,
    globalConfig,
    userConfig,
  });
  return {
    ok: successCount > 0,
    mode,
    input,
    urls: resolvedUrls,
    resultCount: records.length,
    successCount,
    imageCount: 0,
    batchCount: summary.batchResults.length,
    batches: summary.batchResults,
    text: summary.text,
    model: summary.model,
    records,
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
    effectiveConfig?.tools?.web_to_data?.switchWebMode,
  );
  if (!basePath) return [];

  const webToDataTool = new DynamicStructuredTool({
    name: "web_to_data",
    description:
      "根据提供url进行网页解析并提取内容。支持单 URL 或批量 URLs。",
    schema: z.object({
      input: z
        .string()
        .optional()
        .describe("URL 或工作区内 txt 列表文件路径（可包含多行 URL）"),
      urls: z.array(z.string()).optional().describe("批量 URL 列表"),
      prompt: z.string().optional().describe("默认提取网页核心事实并按条目输出"),
      useTrafilatura: z
        .boolean()
        .optional()
        .describe("仅 multimodal 模式生效：是否优先使用 Readability 提取正文，默认 true"),
    }),
    func: async ({ input = "", urls = [], prompt, useTrafilatura }) => {
      const payload = await runWebToDataPipeline({
        agentContext,
        input,
        urls,
        prompt,
        useTrafilatura: useTrafilatura !== false,
        processMode,
      });
      const text = String(payload?.text || "").trim();
      return toToolJsonResult(
        "web_to_data",
        {
          ok: payload?.ok === true,
          status: payload?.ok === true ? "completed" : "failed",
          mode: payload?.mode || processMode,
          message: String(payload?.message || ""),
          input: payload?.input || input || "",
          urls: Array.isArray(payload?.urls) ? payload.urls : [],
          successCount: Number(payload?.successCount || 0),
          resultCount: Number(payload?.resultCount || 0),
          imageCount: Number(payload?.imageCount || 0),
          batchCount: Number(payload?.batchCount || 0),
          text,
          model: payload?.model || {},
          summary: {
            text_length: text.length,
          },
        },
        true,
      );
    },
  });

  return [webToDataTool];
}
