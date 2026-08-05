/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext as filterForModelContextProtocol,
  getMessageToolCalls,
  isCurrentSystemContextMessage,
  isInjectedMessage as isInjectedMessageProtocol,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveInjectedMessageType as resolveInjectedMessageTypeProtocol,
  resolveMessageRole,
  shouldKeepForModelContext,
  shouldMarkCurrentTurnSummarizedByPolicy,
} from "@noobot/context-protocol/message-policy";
import { recoverContextTaskSummaryToolResult } from "@noobot/context-protocol/message-codec";

export const AGENT_MODEL_CONTEXT_POLICY_OPTIONS = Object.freeze({
  recoverUnpairedToolResult: recoverContextTaskSummaryToolResult,
});

export {
  getMessageToolCalls,
  isCurrentSystemContextMessage,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveMessageRole,
  shouldKeepForModelContext,
  shouldMarkCurrentTurnSummarizedByPolicy,
};

export function isInjectedMessage(message = {}) {
  return isInjectedMessageProtocol(message, AGENT_MODEL_CONTEXT_POLICY_OPTIONS);
}

export function resolveInjectedMessageType(message = {}) {
  return resolveInjectedMessageTypeProtocol(message, AGENT_MODEL_CONTEXT_POLICY_OPTIONS);
}

export function filterForModelContext(messages = [], options = {}) {
  return filterForModelContextProtocol(messages, {
    ...AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
    ...options,
  });
}

export function hasTaskSummaryToolCall(message = {}) {
  return getMessageToolCalls(message).some(
    (toolCall) => resolveToolNameFromToolCall(toolCall) === TASK_SUMMARY_TOOL_NAME,
  );
}
