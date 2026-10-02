/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList } from "@noobot/memory-protocol/text";

export function formatDomainBlock({ createdAt = "", experiences = [], lessons = [] } = {}) {
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
