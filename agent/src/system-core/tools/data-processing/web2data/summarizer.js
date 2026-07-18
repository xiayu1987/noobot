/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { filePath as path } from "../../../utils/path-resolver.js";
import { HumanMessage } from "@langchain/core/messages";
import { createChatModelByName, resolveDefaultModelSpec, resolveModelSpecByAlias } from "../../../model/index.js";
import { DEFAULT_MIME_TYPE, IMAGE_EXTENSION_TO_MIME, IMAGE_EXTENSIONS } from "../file-extension-constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { tWeb, toModelText, truncateText } from "./utils.js";
const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;
const MAX_TEXT_CHARS = LENGTH_THRESHOLDS.dataProcessing.webTextChars;
async function buildImageBatches(imagePaths = []) {
  const items = [];
  for (let idx = 0; idx < imagePaths.length; idx += 1) {
    const imagePath = imagePaths[idx];
    const st = await stat(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = IMAGE_EXTENSIONS.has(ext)
      ? (IMAGE_EXTENSION_TO_MIME[ext] || DEFAULT_MIME_TYPE)
      : DEFAULT_MIME_TYPE;
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
export async function summarizeByModel({
  records = [],
  imagePaths = [],
  prompt = "",
  globalConfig = {},
  userConfig = {},
  runtime = {},
}) {
  const okRecords = records.filter((recordItem) => recordItem?.status === "ok");
  const usefulTextParts = okRecords.map(
    (recordItem) => `## ${recordItem?.url || ""}\n${recordItem?.usefulText || ""}`,
  );
  const imageAlias =
    userConfig?.attachments?.attachment_models?.image ||
    globalConfig?.attachments?.attachment_models?.image ||
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
    context: { runtime },
  });
  const userPrompt =
    prompt ||
    tWeb(runtime, "summarizePrompt");
  const sharedText = truncateText(usefulTextParts.join("\n\n"), MAX_TEXT_CHARS, runtime);

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
              text: `${userPrompt}\n\n${tWeb(runtime, "screenshotBatch", {
                batchIndex: batchIndex + 1,
                sharedText,
              })}`,
            },
            ...batch.map((imageItem) => ({
              type: "image_url",
              image_url: { url: imageItem.dataUrl },
            })),
          ],
        }),
      ], { signal: runtime?.abortSignal || undefined });
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
        content: `${userPrompt}\n\n${tWeb(runtime, "textReference", { sharedText })}`,
      }),
    ], { signal: runtime?.abortSignal || undefined });
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
