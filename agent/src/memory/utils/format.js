/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, stripMarkdownFence } from "./text.js";

function normalizeContentBlock(block) {
  if (block === null || block === undefined) return "";
  if (typeof block === "string") return block;
  if (typeof block !== "object") return String(block || "");

  const text = block.text ?? block.content ?? block.output_text;
  if (typeof text === "string") return text;
  if (Array.isArray(text)) {
    return text.map(normalizeContentBlock).filter(Boolean).join("\n");
  }
  return "";
}

export function normalizeModelContent(rawContent) {
  if (rawContent === undefined) return "";
  if (typeof rawContent === "string") return rawContent;
  if (Array.isArray(rawContent)) {
    const text = rawContent.map(normalizeContentBlock).filter(Boolean).join("\n");
    if (text) return text;
  }
  if (rawContent && typeof rawContent === "object") {
    const text = normalizeContentBlock(rawContent);
    if (text) return text;
  }
  try {
    return JSON.stringify(rawContent ?? "");
  } catch {
    return String(rawContent ?? "");
  }
}

export function isBlankLongMemoryContent(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  const normalized = stripMarkdownFence(value).trim();
  if (!normalized) return true;
  return ["null", "undefined", "{}", "[]"].includes(normalized.toLowerCase());
}

export function formatDomainBlock({
  createdAt = "",
  experiences = [],
  lessons = [],
} = {}) {
  const normalizedExperiences = dedupeTextList(experiences);
  const normalizedLessons = dedupeTextList(lessons);
  const expLines = normalizedExperiences.length
    ? normalizedExperiences.map((item) => `- ${item}`).join("\n")
    : "- （无）";
  const lessonLines = normalizedLessons.length
    ? normalizedLessons.map((item) => `- ${item}`).join("\n")
    : "- （无）";
  return [
    `[${createdAt || new Date().toISOString()}]`,
    "经验：",
    expLines,
    "教训：",
    lessonLines,
    "",
  ].join("\n");
}
