/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stripMarkdownFence } from "../utils/text.js";

export function extractJsonCandidate(input = "") {
  const text = stripMarkdownFence(input)
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!text) return "";
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const startIndex =
    firstBrace < 0
      ? firstBracket
      : firstBracket < 0
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (startIndex < 0) return text;
  const startChar = text[startIndex];
  const endChar = startChar === "[" ? "]" : "}";
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === startChar) depth += 1;
    if (ch === endChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1).trim();
      }
    }
  }
  return text.slice(startIndex).trim();
}

