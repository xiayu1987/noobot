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
  hasCheckpointBoundaryToolCall,
  isCheckpointBoundaryToolMessage,
} from "@noobot/context-protocol/policy/summary";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "@noobot/context-protocol/message/internal-types";

export function isCheckpointBoundaryToolResultMessage(msg = {}) {
  return isCheckpointBoundaryToolMessage(msg);
}

export function buildTaskSummaryFallbackHumanMessage(msg = {}) {
  const summaryText = extractTaskSummaryText(msg);
  if (!summaryText) return null;
  return new HumanMessage({
    content: `[阶段小结]
${summaryText}`,
    additional_kwargs: {
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.PHASE_SUMMARY_MEMORY,
      recoveredFromUnpairedTaskSummary: true,
    },
  });
}

export function shouldSkipSummarizedHistoryMessage(msg = {}) {
  if (msg?.summarized !== true) return false;
  return !hasCheckpointBoundaryToolCall(msg) && !isCheckpointBoundaryToolResultMessage(msg);
}

export { normalizeUnpairedTaskSummaryToolResults };
