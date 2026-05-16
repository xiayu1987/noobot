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
      (Array.isArray(items) ? items : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

export function stripMarkdownFence(input = "") {
  const text = String(input || "").trim();
  const matched = /^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/.exec(text);
  return matched ? String(matched[1] || "").trim() : text;
}

