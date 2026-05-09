/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeAiTextContent(aiContent) {
  if (typeof aiContent === "string") return String(aiContent || "");
  if (!Array.isArray(aiContent)) return String(aiContent || "");
  const textParts = aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean);
  return textParts.join("\n");
}
