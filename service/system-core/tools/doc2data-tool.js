/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { normalizeDoc2DataFormat, DOC2DATA_FORMAT } from "../config/core/enums.js";
import {
  invokeModelWithTextAndAttachments,
  resolveModelSpecByAlias,
} from "../model/index.js";
import { convertDocumentToImages } from "../utils/doc/doc2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

const MAX_BATCH_BYTES = Math.floor(0.8 * 1024 * 1024);
const MAX_DIRECT_TEXT_BYTES = 8 * 1024 * 1024;

const DIRECT_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".yaml",
  ".yml",
  ".ini",
  ".conf",
  ".cfg",
  ".log",
  ".sql",
  ".toml",
  ".env",
  ".properties",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
]);

const IMAGE_EXTENSION_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function resolveMimeTypeByPath(filePath = "", preferredMediaType = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  void preferredMediaType;
  return (
    IMAGE_EXTENSION_TO_MIME[extension] ||
    "application/octet-stream"
  );
}

async function toDataUrl(filePath = "", preferredMediaType = "") {
  const mimeType = resolveMimeTypeByPath(filePath, preferredMediaType);
  const contentBase64 = (await readFile(filePath)).toString("base64");
  return `data:${mimeType};base64,${contentBase64}`;
}

function resolveAttachmentAliasByType({
  globalConfig,
  userConfig,
  mediaType = "image",
}) {
  const normalizedMediaType = String(mediaType || "image").trim() || "image";
  return (
    userConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    globalConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    ""
  );
}

function isLikelyUtf8Text(contentBuffer) {
  if (!Buffer.isBuffer(contentBuffer) || !contentBuffer.length) return false;
  if (contentBuffer.includes(0x00)) return false;

  const decodedText = contentBuffer.toString("utf8");
  if (!decodedText.trim()) return false;

  let readableCharCount = 0;
  for (let charIndex = 0; charIndex < decodedText.length; charIndex += 1) {
    const codePoint = decodedText.charCodeAt(charIndex);
    const isWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    const isPrintableAscii = codePoint >= 32 && codePoint <= 126;
    const isCommonUnicode = codePoint >= 0x4e00;
    if (isWhitespace || isPrintableAscii || isCommonUnicode) {
      readableCharCount += 1;
    }
  }

  const readableRatio = readableCharCount / Math.max(decodedText.length, 1);
  const replacementCharCount = (decodedText.match(/\uFFFD/g) || []).length;
  return readableRatio >= 0.75 && replacementCharCount <= decodedText.length * 0.05;
}

async function readDirectTextDocumentIfAvailable(filePath = "") {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) return null;

  const fileStat = await stat(normalizedFilePath);
  if (!fileStat.isFile()) return null;
  if (Number(fileStat.size || 0) <= 0) {
    return { text: "", bytes: 0 };
  }
  if (Number(fileStat.size || 0) > MAX_DIRECT_TEXT_BYTES) return null;

  const extension = path.extname(normalizedFilePath).toLowerCase();
  const contentBuffer = await readFile(normalizedFilePath);
  const extensionMarkedAsText = DIRECT_TEXT_EXTENSIONS.has(extension);
  const canReadAsText = extensionMarkedAsText || isLikelyUtf8Text(contentBuffer);
  if (!canReadAsText) return null;

  return {
    text: contentBuffer.toString("utf8"),
    bytes: Number(contentBuffer.length || 0),
  };
}

function normalizeModelOutput(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

function resolveDoc2DataPrompt(runtime = {}, prompt = "") {
  const customPrompt = String(prompt || "").trim();
  if (customPrompt) return customPrompt;
  return tTool(runtime, "tools.doc2data.extractPrompt");
}

async function buildImageBatches(imagePaths) {
  const inputs = await Promise.all(
    imagePaths.map(async (imagePath, pageIndex) => {
      const fileStat = await stat(imagePath);
      return {
        page: pageIndex + 1,
        imagePath,
        sizeBytes: Number(fileStat?.size || 0),
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
        .string()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldImageFormat")),
    }),
    func: async ({ filePath, prompt, dpi, imageFormat }) => {
      const normalizedFormat = normalizeDoc2DataFormat(imageFormat);
      const resolvedFormat = normalizedFormat || DOC2DATA_FORMAT.PNG;

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

      const directTextDocument = await readDirectTextDocumentIfAvailable(inputFile);
      if (directTextDocument) {
        return toToolJsonResult(
          "doc_to_data",
          {
            ok: true,
            status: "completed",
            mode: "direct_text",
            input: inputFile,
            text: directTextDocument.text,
            summary: {
              bytes: Number(directTextDocument.bytes || 0),
              text_length: directTextDocument.text.length,
            },
          },
          true,
        );
      }

      const outputRoot = path.join(
        basePath,
        "runtime",
        "workspace",
        ".doc2data",
      );

      const converted = await convertDocumentToImages({
        inputFile,
        outputRoot,
        format: resolvedFormat,
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

      const imageAlias = resolveAttachmentAliasByType({
        globalConfig,
        userConfig,
        mediaType: "image",
      });
      const modelSpec = resolveModelSpecByAlias({
        alias: imageAlias,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      });
      const userPrompt = resolveDoc2DataPrompt(runtime, prompt);

      const imageBatches = await buildImageBatches(images);
      const batchResults = [];
      for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
        const batch = imageBatches[batchIndex];
        const pageNumbers = batch.map((imageItem) => imageItem.page);
        const range = `${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
        const modelResult = await invokeModelWithTextAndAttachments({
          modelName: modelSpec?.alias || modelSpec?.model,
          text: `${userPrompt}\n\n${tTool(runtime, "tools.doc2data.batchPrompt", {
            batchIndex: batchIndex + 1,
            range,
          })}`,
          attachments: batch.map((imageItem) => ({
            mediaType: "image",
            mimeType: resolveMimeTypeByPath(imageItem.imagePath, "image"),
            dataUrl: imageItem.dataUrl,
          })),
          globalConfig,
          userConfig,
          streaming: false,
        });
        const text = normalizeModelOutput(modelResult?.response?.content);
        batchResults.push({
          batch: batchIndex + 1,
          pages: pageNumbers,
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
          mode: "image_model",
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
