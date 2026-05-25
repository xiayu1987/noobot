/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const TRAILING_COMMA_RE = /,\s*([}\]])/g;

export function extractJsonObjectFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const candidates = [raw.match(/\{[\s\S]*\}/), raw.match(/\[[\s\S]*\]/)];
  for (const matched of candidates) {
    const segment = matched?.[0];
    if (!segment) continue;
    try {
      return JSON.parse(segment);
    } catch {}
  }
  return null;
}

export function sanitizeJsonCandidate(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fencedBlocks = Array.from(raw.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/gi));
  const preferredBlock = fencedBlocks
    .map((item) => String(item?.[1] || "").trim())
    .find((block) => block.includes("{") || block.includes("["));
  const fallbackBlock = String(fencedBlocks?.[0]?.[1] || "").trim();
  const source = preferredBlock || fallbackBlock || raw;
  return source
    .replace(/^\s*json\s*/i, "")
    .replace(TRAILING_COMMA_RE, "$1")
    .trim();
}
