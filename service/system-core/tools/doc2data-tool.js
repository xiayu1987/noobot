/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createChatModelByName, resolveModelSpecByAlias } from "../model/index.js";
import { convertDocumentToImages } from "../utils/doc/doc2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

const MAX_BATCH_BYTES = Math.floor(0.8 * 1024 * 1024);

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

function resolveAttachmentImageAlias({ globalConfig, userConfig }) {
  return (
    userConfig?.attachments?.attachmentModels?.image ||
    globalConfig?.attachments?.attachmentModels?.image ||
    ""
  );
}

async function buildImageBatches(imagePaths) {
  const inputs = await Promise.all(
    imagePaths.map(async (imagePath, idx) => {
      const st = await stat(imagePath);
      return {
        page: idx + 1,
        imagePath,
        sizeBytes: Number(st?.size || 0),
        dataUrl: await toDataUrl(imagePath),
      };
    }),
  );

  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const item of inputs) {
    const nextBytes = currentBytes + item.sizeBytes;
    if (current.length > 0 && nextBytes > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [item];
      currentBytes = item.sizeBytes;
      continue;
    }
    current.push(item);
    currentBytes = nextBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function createDoc2DataTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) return [];

  const doc2dataTool = new DynamicStructuredTool({
    name: "doc_to_data",
    description: tTool(runtime, "tools.doc2data.description"),
    schema: z.object({
      filePath: z.string().describe(tTool(runtime, "tools.doc2data.fieldFilePath")),
      prompt: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldPrompt")),
      dpi: z
        .number()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldDpi")),
      imageFormat: z
        .enum(["png", "jpg", "jpeg"])
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldImageFormat")),
    }),
    func: async ({ filePath, prompt, dpi, imageFormat = "png" }) => {
      const normalizedDpi = Number(dpi);
      const resolvedDpi =
        Number.isFinite(normalizedDpi) && normalizedDpi > 0
          ? Math.floor(normalizedDpi)
          : 180;
      const inputFile = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const outputRoot = path.join(
        basePath,
        "runtime",
        "workspace",
        ".doc2data",
      );

      const converted = await convertDocumentToImages({
        inputFile,
        outputRoot,
        format: imageFormat,
        dpi: resolvedDpi,
      });

      const images = converted.imagePaths || [];
      if (!images.length) {
        return toToolJsonResult(
          "doc_to_data",
          {
            ok: false,
            message: tTool(runtime, "tools.doc2data.noImagesProduced"),
            input: converted.input,
          },
          true,
        );
      }

      const imageAlias = resolveAttachmentImageAlias({
        globalConfig,
        userConfig,
      });
      const modelSpec = resolveModelSpecByAlias({
        alias: imageAlias,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      });
      const llm = createChatModelByName(modelSpec?.alias || modelSpec?.model, {
        globalConfig,
        userConfig,
        streaming: false,
      });
      const userPrompt =
        prompt || tTool(runtime, "tools.doc2data.extractPrompt");

      const imageBatches = await buildImageBatches(images);
      const batchResults = [];
      for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
        const batch = imageBatches[batchIndex];
        const pageNums = batch.map((imageItem) => imageItem.page);
        const range = `${pageNums[0]}-${pageNums[pageNums.length - 1]}`;
        const message = new HumanMessage({
          content: [
            {
              type: "text",
              text: `${userPrompt}\n\n${tTool(runtime, "tools.doc2data.batchPrompt", {
                batchIndex: batchIndex + 1,
                range,
              })}`,
            },
            ...batch.map((imageItem) => ({
              type: "image_url",
              image_url: { url: imageItem.dataUrl },
            })),
          ],
        });
        const res = await llm.invoke([message]);
        const text =
          typeof res?.content === "string"
            ? res.content
            : JSON.stringify(res?.content || "");
        batchResults.push({
          batch: batchIndex + 1,
          pages: pageNums,
          totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
          text,
        });
      }
      const mergedText = batchResults.map((batchResult) => batchResult.text).join("\n\n");
      const totalImageBytes = imageBatches
        .flatMap((batch) => batch)
        .reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0);

      return toToolJsonResult(
        "doc_to_data",
        {
          ok: true,
          status: "completed",
          input: converted.input,
          pdfPath: converted.pdfPath,
          imageCount: images.length,
          text: mergedText,
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
          summary: {
            batch_count: batchResults.length,
            total_image_bytes: totalImageBytes,
            batch_max_bytes: MAX_BATCH_BYTES,
            text_length: mergedText.length,
            pages: batchResults.flatMap((item) => item.pages || []),
          },
        },
        true,
      );
    },
  });

  return [doc2dataTool];
}
