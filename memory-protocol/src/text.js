/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function sanitizeFileName(input = "", fallback = "untitled") {
  const cleaned = String(input || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
}

export function dedupeTextList(items = []) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean),
    ),
  );
}

const MARKDOWN_FENCE = "```";
const FENCE_LANGUAGE_CHAR = /[a-zA-Z0-9_-]/;

export function stripMarkdownFence(input = "") {
  const text = String(input || "").trim();
  const fenceLength = MARKDOWN_FENCE.length;
  if (
    text.length < fenceLength * 2 ||
    !text.startsWith(MARKDOWN_FENCE) ||
    !text.endsWith(MARKDOWN_FENCE)
  ) {
    return text;
  }
  const contentEnd = text.length - fenceLength;
  let contentStart = fenceLength;
  while (contentStart < contentEnd && FENCE_LANGUAGE_CHAR.test(text[contentStart])) {
    contentStart += 1;
  }
  return text.slice(contentStart, contentEnd).trim();
}
