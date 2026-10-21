/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { normalizeUnpairedTaskSummaryToolResults } from "@noobot/context-protocol/policy/block";
import { recoverContextTaskSummaryToolResult } from "@noobot/context-protocol/task/summary-context";
import {
  projectContextMessageModelMetadata,
  resolveContextMessageSummarized,
} from "@noobot/context-protocol/message/codec";
import {
  hasCheckpointBoundaryToolCall,
  isCheckpointBoundaryToolMessage,
} from "@noobot/context-protocol/policy/summary";
import { tSystem } from "noobot-i18n/agent/system-text";

export function isCheckpointBoundaryToolResultMessage(msg = {}) {
  return isCheckpointBoundaryToolMessage(msg);
}

export function buildTaskSummaryFallbackHumanMessage(msg = {}, { locale }) {
  const recovered = recoverContextTaskSummaryToolResult(msg);
  if (!recovered) return null;
  return new HumanMessage({
    content: `${tSystem("context.phaseSummaryTitle", locale)}\n${recovered.content}`,
    additional_kwargs: projectContextMessageModelMetadata(recovered),
  });
}

export function shouldSkipSummarizedHistoryMessage(msg = {}) {
  if (!resolveContextMessageSummarized(msg)) return false;
  return !hasCheckpointBoundaryToolCall(msg) && !isCheckpointBoundaryToolResultMessage(msg);
}

export { normalizeUnpairedTaskSummaryToolResults };
