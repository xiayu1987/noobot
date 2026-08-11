/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { resolveDefaultModelSpec, resolveModelSpecByAlias } from "../../../models/index.js";
import {
  DEFAULT_MIME_TYPE,
  IMAGE_EXTENSION_TO_MIME,
  IMAGE_EXTENSIONS,
} from "../file-extension-constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { tWeb, truncateText } from "./utils.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;
const MAX_TEXT_CHARS = LENGTH_THRESHOLDS.dataProcessing.webTextChars;
async function buildImageBatches(imagePaths = []) {
  const items = [];
  for (let idx = 0; idx < imagePaths.length; idx += 1) {
    const imagePath = imagePaths[idx];
    const st = await stat(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = IMAGE_EXTENSIONS.has(ext)
      ? IMAGE_EXTENSION_TO_MIME[ext] || DEFAULT_MIME_TYPE
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
  if (imagePaths.length > 0 && !imageAlias) {
    throw new Error("web2data multimodal mode requires an explicit image model");
  }
  const modelSpec =
    imagePaths.length > 0
      ? resolveModelSpecByAlias({
          alias: imageAlias,
          globalConfig,
          userConfig,
          fallbackToDefault: false,
        })
      : resolveDefaultModelSpec({ globalConfig, userConfig });
  if (!modelSpec) {
    throw new Error(
      imagePaths.length > 0
        ? `configured image model not found: ${imageAlias}`
        : "web2data model is not configured",
    );
  }
  const modelPort = runtime?.modelPort;
  if (!modelPort || typeof modelPort.invoke !== "function") {
    throw new Error("web2data requires runtime.modelPort");
  }
  const invokeModel = (messages) =>
    modelPort.invoke({
      model: modelSpec,
      messages,
      options: {
        streaming: false,
        signal: runtime?.abortSignal || undefined,
      },
      invocation: {
        flow: "tool.web2data",
        purpose: "content_extraction",
        domain: "data_processing",
        contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
      },
    });
  const userPrompt = prompt || tWeb(runtime, "summarizePrompt");
  const sharedText = truncateText(usefulTextParts.join("\n\n"), MAX_TEXT_CHARS, runtime);

  const batchResults = [];
  if (imagePaths.length > 0) {
    const batches = await buildImageBatches(imagePaths);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const output = await invokeModel([
        {
          role: "user",
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
        },
      ]);
      batchResults.push({
        batch: batchIndex + 1,
        imageCount: batch.length,
        totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
        imagePaths: batch.map((imageItem) => imageItem.imagePath),
        text: output.output.text,
      });
    }
  } else {
    const output = await invokeModel([
      {
        role: "user",
        content: `${userPrompt}\n\n${tWeb(runtime, "textReference", { sharedText })}`,
      },
    ]);
    batchResults.push({
      batch: 1,
      imageCount: 0,
      totalBytes: 0,
      imagePaths: [],
      text: output.output.text,
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
