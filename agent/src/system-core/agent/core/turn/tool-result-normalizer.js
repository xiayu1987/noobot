/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractAttachmentMetasFromToolResult } from "../media/artifact-service.js";

export function normalizeToolResultAttachmentMetas(toolCallResult = {}, call = {}) {
  const toolResultText = String(toolCallResult?.toolResultText || "");
  const fallbackExtractedAttachmentMetas = extractAttachmentMetasFromToolResult(
    call?.name || "",
    toolResultText,
  );
  return Array.isArray(toolCallResult?.extractedAttachmentMetas) &&
    toolCallResult.extractedAttachmentMetas.length
    ? toolCallResult.extractedAttachmentMetas
    : fallbackExtractedAttachmentMetas;
}
