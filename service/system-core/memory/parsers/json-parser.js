/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeModelContent } from "../utils/format.js";
import { extractJsonCandidate } from "./json-extractor.js";

export function parseJsonWithLogging({
  rawContent = "",
  stage = "",
  defaultValue = null,
  onError = null,
} = {}) {
  const content = normalizeModelContent(rawContent);
  const text = typeof content === "string" ? content : String(content || "");
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    if (text.trim() && typeof onError === "function") {
      onError({
        stage,
        rawContent: text,
        candidate,
        error: "json_candidate_not_found",
      });
    }
    return { parsed: defaultValue, candidate: "", rawText: text };
  }
  try {
    return { parsed: JSON.parse(candidate), candidate, rawText: text };
  } catch (error) {
    if (typeof onError === "function") {
      onError({
        stage,
        rawContent: text,
        candidate,
        error: error?.message || "json_parse_failed",
      });
    }
    return { parsed: defaultValue, candidate, rawText: text };
  }
}

