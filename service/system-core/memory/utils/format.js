/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, stripMarkdownFence } from "./text.js";

export function normalizeModelContent(rawContent) {
  if (rawContent === undefined) return "";
  if (typeof rawContent === "string") return rawContent;
  try {
    return JSON.parse(JSON.stringify(rawContent));
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

