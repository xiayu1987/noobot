/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function sanitizeFileName(input = "", fallback = "untitled") {
  const cleaned = text(input)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
}

export function dedupeTextList(items = []) {
  return Array.from(
    new Set((Array.isArray(items) ? items : []).map((item) => text(item)).filter(Boolean)),
  );
}

const MARKDOWN_FENCE = "```";
const FENCE_LANGUAGE_CHAR = /[a-zA-Z0-9_-]/;

export function stripMarkdownFence(input = "") {
  const normalizedText = text(input);
  const fenceLength = MARKDOWN_FENCE.length;
  if (
    normalizedText.length < fenceLength * 2 ||
    !normalizedText.startsWith(MARKDOWN_FENCE) ||
    !normalizedText.endsWith(MARKDOWN_FENCE)
  ) {
    return normalizedText;
  }
  const contentEnd = normalizedText.length - fenceLength;
  let contentStart = fenceLength;
  while (contentStart < contentEnd && FENCE_LANGUAGE_CHAR.test(normalizedText[contentStart])) {
    contentStart += 1;
  }
  return normalizedText.slice(contentStart, contentEnd).trim();
}
