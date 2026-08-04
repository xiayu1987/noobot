/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  collectLatestTaskSummaryMessageIndexes as collectLatestTaskSummaryMessageIndexesProtocol,
  collectScopedMessagesToSummarize as collectScopedMessagesToSummarizeProtocol,
  filterSummarizedMessages as filterSummarizedMessagesProtocol,
  getMessageRole,
  getModelMessageType,
  hasTaskSummaryToolCall,
  isTaskSummaryToolMessage,
  markCurrentTurnArraySummarized as markCurrentTurnArraySummarizedProtocol,
  markCurrentTurnModelMessagesSummarized as markCurrentTurnModelMessagesSummarizedProtocol,
  markCurrentTurnStoreSummarized as markCurrentTurnStoreSummarizedProtocol,
  resolveToolNameFromMessage,
  resolveToolNamesFromToolCalls,
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedMessageInScope as shouldMarkCurrentTurnSummarizedMessageInScopeProtocol,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "@noobot/context-protocol/summary-policy";
import { AGENT_MODEL_CONTEXT_POLICY_OPTIONS } from "./message-context-policy.js";

export const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";

export {
  getMessageRole,
  getModelMessageType,
  hasTaskSummaryToolCall,
  isTaskSummaryToolMessage,
  resolveToolNameFromMessage,
  resolveToolNamesFromToolCalls,
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
};

export function collectLatestTaskSummaryMessageIndexes(messages = [], options = {}) {
  return collectLatestTaskSummaryMessageIndexesProtocol(messages, options);
}

export function collectScopedMessagesToSummarize(messages = [], options = {}) {
  return collectScopedMessagesToSummarizeProtocol(messages, {
    ...options,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function shouldMarkCurrentTurnSummarizedMessageInScope(message = {}, options = {}) {
  return shouldMarkCurrentTurnSummarizedMessageInScopeProtocol(message, {
    ...options,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function markCurrentTurnStoreSummarized(store = null, options = {}) {
  return markCurrentTurnStoreSummarizedProtocol(store, {
    ...options,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function markCurrentTurnArraySummarized(messages = [], options = {}) {
  return markCurrentTurnArraySummarizedProtocol(messages, {
    ...options,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function markCurrentTurnModelMessagesSummarized(messages = [], options = {}) {
  return markCurrentTurnModelMessagesSummarizedProtocol(messages, {
    ...options,
    policyOptions: AGENT_MODEL_CONTEXT_POLICY_OPTIONS,
  });
}

export function filterSummarizedMessages(messages = []) {
  return filterSummarizedMessagesProtocol(messages, AGENT_MODEL_CONTEXT_POLICY_OPTIONS);
}
