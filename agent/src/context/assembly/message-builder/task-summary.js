/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import {
  extractTaskSummaryText,
  normalizeUnpairedTaskSummaryToolResults,
} from "@noobot/context-protocol/policy/block";
import {
  hasTaskSummaryToolCall,
  isTaskSummaryToolMessage,
} from "@noobot/context-protocol/policy/summary";

export function isTaskSummaryToolResultMessage(msg = {}) {
  return isTaskSummaryToolMessage(msg);
}

export function buildTaskSummaryFallbackHumanMessage(msg = {}) {
  const summaryText = extractTaskSummaryText(msg);
  if (!summaryText) return null;
  return new HumanMessage({
    content: `[阶段小结]
${summaryText}`,
    additional_kwargs: {
      noobotInternalMessageType: "phase_summary_memory",
      recoveredFromUnpairedTaskSummary: true,
    },
  });
}

export function shouldSkipSummarizedHistoryMessage(msg = {}) {
  if (msg?.summarized !== true) return false;
  return !hasTaskSummaryToolCall(msg) && !isTaskSummaryToolResultMessage(msg);
}

export { normalizeUnpairedTaskSummaryToolResults };
