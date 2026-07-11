/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { filePath as path } from "../../../utils/path-resolver.js";
import { DEFAULT_MIME_TYPE, IMAGE_EXTENSION_TO_MIME, IMAGE_EXTENSIONS, TEXT_EXTENSIONS } from "../file-extension-constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { DOC2DATA_PARSE_ENGINE, normalizeDoc2DataParseEngine } from "../../../config/core/enums.js";
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { resolveCanonicalUserSourceAttachment } from "../../../attach/index.js";
import { tTool } from "../../core/tool-i18n.js";

const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;
const MAX_DIRECT_TEXT_BYTES = LENGTH_THRESHOLDS.dataProcessing.directTextBytes;

export function resolveMimeTypeByPath(filePath = "", preferredMediaType = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  void preferredMediaType;
  if (!IMAGE_EXTENSIONS.has(extension)) return DEFAULT_MIME_TYPE;
  return (
    IMAGE_EXTENSION_TO_MIME[extension] ||
    DEFAULT_MIME_TYPE
  );
}

async function toDataUrl(filePath = "", preferredMediaType = "") {
  const mimeType = resolveMimeTypeByPath(filePath, preferredMediaType);
  const contentBase64 = (await readFile(filePath)).toString("base64");
  return `data:${mimeType};base64,${contentBase64}`;
}

export function resolveAttachmentAliasByType({
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

export async function readDirectTextDocumentIfAvailable(filePath = "") {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) return null;

  const fileStat = await stat(normalizedFilePath);
  if (!fileStat.isFile()) return null;
  if (Number(fileStat.size || 0) <= 0) {
    return { text: "", bytes: 0 };
  }

  const extension = path.extname(normalizedFilePath).toLowerCase();
  const extensionMarkedAsText = TEXT_EXTENSIONS.has(extension);
  // For files explicitly marked as text (e.g. .txt/.md/.csv), keep parsing via
  // direct read even when file is larger than MAX_DIRECT_TEXT_BYTES.
  if (!extensionMarkedAsText && Number(fileStat.size || 0) > MAX_DIRECT_TEXT_BYTES) return null;

  const contentBuffer = await readFile(normalizedFilePath);
  const canReadAsText = extensionMarkedAsText || isLikelyUtf8Text(contentBuffer);
  if (!canReadAsText) return null;

  return {
    text: contentBuffer.toString("utf8"),
    bytes: Number(contentBuffer.length || 0),
  };
}

export function normalizeModelOutput(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

export function resolveDoc2DataPrompt(runtime = {}, prompt = "") {
  const customPrompt = String(prompt || "").trim();
  if (customPrompt) return customPrompt;
  return tTool(runtime, "tools.doc2data.extractPrompt");
}

export function resolveDoc2DataParseEngine(
  runtime = {},
  parseEngine = "",
  userConfig = {},
  globalConfig = {},
) {
  const inputParseEngine = String(parseEngine || "").trim();
  const configuredParseEngine =
    userConfig?.tools?.doc_to_data?.parse_engine ||
    userConfig?.tools?.doc_to_data?.parseEngine ||
    globalConfig?.tools?.doc_to_data?.parse_engine ||
    globalConfig?.tools?.doc_to_data?.parseEngine ||
    "";
  const parseEngineCandidate = inputParseEngine || String(configuredParseEngine || "").trim();
  const normalizedParseEngine = normalizeDoc2DataParseEngine(parseEngineCandidate);
  if (!normalizedParseEngine && parseEngineCandidate) {
    throw recoverableToolError(
      tTool(runtime, "tools.doc2data.unsupportedParseEngine", {
        parseEngine: parseEngineCandidate,
      }),
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { parseEngine: parseEngineCandidate },
      },
    );
  }
  return normalizedParseEngine || DOC2DATA_PARSE_ENGINE.LIBREOFFICE;
}

export function isImageInputFile(filePath = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

export function isLegacyDocInputFile(filePath = "") {
  return path.extname(String(filePath || "")).toLowerCase() === ".doc";
}

export async function resolveDocInputAttachmentMeta(filePath = "", agentContext = {}, attachmentId = "") {
  return resolveCanonicalUserSourceAttachment({
    filePath,
    attachmentId,
    agentContext,
  });
}

export async function buildImageBatches(imagePaths) {
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
