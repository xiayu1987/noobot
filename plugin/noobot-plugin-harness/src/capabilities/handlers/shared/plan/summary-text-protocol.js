/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

const SUMMARY_OVERVIEW_BLOCK_RE =
  /\[SUMMARY_OVERVIEW\]([\s\S]*?)(?=\[SUMMARY_DETAIL\]|\[SUMMARY_END\]|$)/i;
const SUMMARY_DETAIL_BLOCK_RE =
  /\[SUMMARY_DETAIL\]([\s\S]*?)(?=\[NEXT_EXECUTION_SUGGESTION\]|\[SUMMARY_END\]|$)/i;
const NEXT_EXECUTION_SUGGESTION_BLOCK_RE =
  /\[NEXT_EXECUTION_SUGGESTION\]([\s\S]*?)(?=\[SUMMARY_END\]|$)/i;
const SUMMARY_END_MARKER_RE = /\[SUMMARY_END\]/i;

export function parseSummaryOverviewAndDetailFromText(summaryText = "") {
  const raw = text(summaryText);
  if (!raw)
    return {
      overviewText: "",
      detailText: "",
      nextSuggestionText: "",
      trailingText: "",
      usedV2: false,
    };
  const overviewMatch = raw.match(SUMMARY_OVERVIEW_BLOCK_RE);
  const detailMatch = raw.match(SUMMARY_DETAIL_BLOCK_RE);
  const nextSuggestionMatch = raw.match(NEXT_EXECUTION_SUGGESTION_BLOCK_RE);
  const endMatch = raw.match(SUMMARY_END_MARKER_RE);
  if (!overviewMatch && !detailMatch && !nextSuggestionMatch) {
    return {
      overviewText: raw,
      detailText: "",
      nextSuggestionText: "",
      trailingText: "",
      usedV2: false,
    };
  }
  const overviewText = text(overviewMatch?.[1]);
  const detailText = text(detailMatch?.[1]);
  const nextSuggestionText = text(nextSuggestionMatch?.[1]);
  const trailingText = endMatch
    ? String(raw.slice(Number(endMatch.index) + String(endMatch[0] || "").length)).trim()
    : "";
  return {
    overviewText: overviewText || raw,
    detailText,
    nextSuggestionText,
    trailingText,
    usedV2: true,
  };
}
