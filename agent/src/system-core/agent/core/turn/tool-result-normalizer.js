/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractAttachmentsFromToolResult } from "../media/artifact-service.js";

export function normalizeToolResultAttachments(toolCallResult = {}, call = {}) {
  const toolResultText = String(toolCallResult?.toolResultText || "");
  const fallbackExtractedAttachments = extractAttachmentsFromToolResult(
    call?.name || "",
    toolResultText,
  );
  return Array.isArray(toolCallResult?.extractedAttachments) &&
    toolCallResult.extractedAttachments.length
    ? toolCallResult.extractedAttachments
    : fallbackExtractedAttachments;
}
