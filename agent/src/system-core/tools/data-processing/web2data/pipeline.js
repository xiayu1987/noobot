/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { filePath as path } from "../../../utils/path-resolver.js";
import { getRuntimeFromAgentContext } from "../../../context/agent-context-accessor.js";
import { runWeb2Img } from "../../../utils/web/web2img.js";
import { TOOL_DATA_MODE, TOOL_RESULT_STATUS } from "../../constants/index.js";
import { resolveInputUrls } from "./input.js";
import { runBrowserSimulateExtract, runDirectFetchExtract } from "./extractors.js";
import { summarizeByModel } from "./summarizer.js";
import { DEFAULT_CONCURRENCY, normalizeConcurrency, normalizeProcessMode, tWeb } from "./utils.js";
export async function runWebToDataPipeline({
  agentContext,
  input = "",
  urls = [],
  prompt = "",
  useTrafilatura = true,
  processMode = "",
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) {
    return { ok: false, message: tWeb(runtime, "runtimeBasePathMissing") };
  }

  const resolvedUrls = await resolveInputUrls({ input, urls, agentContext });
  if (!resolvedUrls.length) {
    return { ok: false, message: tWeb(runtime, "noProcessableUrl"), urls: [] };
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
        message: tWeb(runtime, "noSuccessfulResult"),
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
      } catch {
        // Text sidecar may be missing for partial web2img results; keep record with empty text.
      }
      try {
        fullText = await readFile(String(item?.full_text_path || ""), "utf8");
      } catch {
        // Text sidecar may be missing for partial web2img results; keep record with empty text.
      }
      records.push({
        url: String(item?.url || ""),
        status: TOOL_RESULT_STATUS.OK,
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
      runtime,
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
    mode === TOOL_DATA_MODE.BROWSER_SIMULATE
      ? await runBrowserSimulateExtract(resolvedUrls, parallelism, runtime)
      : await runDirectFetchExtract(resolvedUrls, parallelism, runtime);
  const successCount = records.filter(
    (recordItem) => recordItem?.status === TOOL_RESULT_STATUS.OK,
  ).length;
  if (successCount <= 0) {
    const errorMessages = records
      .map((recordItem) =>
        recordItem?.status === TOOL_RESULT_STATUS.ERROR
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
        ? tWeb(runtime, "fetchFailedWithErrors", { errors: errorMessages.join(" | ") })
        : tWeb(runtime, "fetchFailedNoResult"),
      records,
    };
  }
  const summary = await summarizeByModel({
    records,
    imagePaths: [],
    prompt,
    globalConfig,
    userConfig,
    runtime,
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
