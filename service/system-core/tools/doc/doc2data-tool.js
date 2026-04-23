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
import { createChatModelByName, resolveModelSpecByAlias } from "../../model/index.js";
import { convertDocumentToImages } from "./doc2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "../check-tool-input.js";
import { toToolJsonResult } from "../tool-json-result.js";

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
    userConfig?.attachmentModels?.image ||
    globalConfig?.attachmentModels?.image ||
    ""
  );
}

async function buildImageBatches(imagePaths) {
  const inputs = [];
  for (let idx = 0; idx < imagePaths.length; idx += 1) {
    const imagePath = imagePaths[idx];
    const st = await stat(imagePath);
    inputs.push({
      page: idx + 1,
      imagePath,
      sizeBytes: Number(st?.size || 0),
      dataUrl: await toDataUrl(imagePath),
    });
  }

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
  const basePath = agentContext?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) return [];

  const doc2dataTool = new DynamicStructuredTool({
    name: "doc_to_data",
    description:
      "将文档提取文字。支持 office/pdf/图片。filePath 可传工作区相对路径或用户目录内绝对路径。",
    schema: z.object({
      filePath: z.string().describe("待处理文档路径（工作区相对路径或用户目录内绝对路径）"),
      prompt: z
        .string()
        .optional()
        .describe("默认提取全部可读文字并保持原结构"),
      dpi: z
        .number()
        .optional()
        .describe("文档转图片DPI，默认180"),
      imageFormat: z
        .enum(["png", "jpg", "jpeg"])
        .optional()
        .describe("文档转图片格式，默认 png"),
    }),
    func: async ({ filePath, prompt, dpi, imageFormat }) => {
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
        format: imageFormat || "png",
        dpi: resolvedDpi,
      });

      const images = converted.imagePaths || [];
      if (!images.length) {
        return toToolJsonResult(
          "doc_to_data",
          {
            ok: false,
            message: "no images produced",
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
        prompt || "请提取图片中的全部可读文字，按原有结构输出，不要编造内容。";

      const imageBatches = await buildImageBatches(images);
      const batchResults = [];
      for (let i = 0; i < imageBatches.length; i += 1) {
        const batch = imageBatches[i];
        const pageNums = batch.map((x) => x.page);
        const range = `${pageNums[0]}-${pageNums[pageNums.length - 1]}`;
        const message = new HumanMessage({
          content: [
            {
              type: "text",
              text: `${userPrompt}\n\n这是第 ${i + 1} 批图片，页码范围 ${range}。请按页码顺序输出。`,
            },
            ...batch.map((img) => ({
              type: "image_url",
              image_url: { url: img.dataUrl },
            })),
          ],
        });
        const res = await llm.invoke([message]);
        const text =
          typeof res?.content === "string"
            ? res.content
            : JSON.stringify(res?.content || "");
        batchResults.push({
          batch: i + 1,
          pages: pageNums,
          totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
          imagePaths: batch.map((x) => x.imagePath),
          text,
        });
      }

      return toToolJsonResult(
        "doc_to_data",
        {
          ok: true,
          input: converted.input,
          pdfPath: converted.pdfPath,
          imageCount: images.length,
          processedImageCount: images.length,
          imagePaths: images,
          batchMaxBytes: MAX_BATCH_BYTES,
          batchCount: batchResults.length,
          batches: batchResults,
          text: batchResults.map((b) => b.text).join("\n\n"),
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
        },
        true,
      );
    },
  });

  return [doc2dataTool];
}
