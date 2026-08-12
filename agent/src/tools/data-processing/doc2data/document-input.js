/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { IMAGE_EXTENSIONS, TEXT_EXTENSIONS } from "../file-extension-constants.js";
import { resolveCanonicalUserSourceAttachment } from "../../../artifacts/index.js";

const MAX_DIRECT_TEXT_BYTES = LENGTH_THRESHOLDS.dataProcessing.directTextBytes;

function isLikelyUtf8Text(contentBuffer) {
  if (!Buffer.isBuffer(contentBuffer) || !contentBuffer.length || contentBuffer.includes(0x00)) return false;
  const decodedText = contentBuffer.toString("utf8");
  if (!decodedText.trim()) return false;
  let readableCharCount = 0;
  for (let index = 0; index < decodedText.length; index += 1) {
    const codePoint = decodedText.charCodeAt(index);
    if (
      codePoint === 9 || codePoint === 10 || codePoint === 13 ||
      (codePoint >= 32 && codePoint <= 126) || codePoint >= 0x4e00
    ) readableCharCount += 1;
  }
  const replacementCharCount = (decodedText.match(/\uFFFD/g) || []).length;
  return readableCharCount / Math.max(decodedText.length, 1) >= 0.75 &&
    replacementCharCount <= decodedText.length * 0.05;
}

export async function readDirectTextDocumentIfAvailable(filePath = "") {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) return null;
  const fileStat = await stat(normalizedFilePath);
  if (!fileStat.isFile()) return null;
  if (Number(fileStat.size || 0) <= 0) return { text: "", bytes: 0 };
  const extensionMarkedAsText = TEXT_EXTENSIONS.has(path.extname(normalizedFilePath).toLowerCase());
  if (!extensionMarkedAsText && Number(fileStat.size || 0) > MAX_DIRECT_TEXT_BYTES) return null;
  const contentBuffer = await readFile(normalizedFilePath);
  if (!extensionMarkedAsText && !isLikelyUtf8Text(contentBuffer)) return null;
  return { text: contentBuffer.toString("utf8"), bytes: Number(contentBuffer.length || 0) };
}

export function isImageInputFile(filePath = "") {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

export function isLegacyDocInputFile(filePath = "") {
  return path.extname(String(filePath || "")).toLowerCase() === ".doc";
}

export async function resolveDocInputAttachmentMeta(agentContext = {}, attachmentId = "") {
  return resolveCanonicalUserSourceAttachment({ attachmentId, agentContext });
}
