/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  getMessageToolCalls,
  isInjectedMessage,
  readMessageField,
  resolveInjectedMessageType,
  resolveMessageDialogProcessId,
  resolveMessageRole,
  resolveMessageId,
  resolveToolCallId,
  shouldMarkCurrentTurnSummarizedByPolicy,
} from "./message-policy.js";
import { SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES } from "./injected-message-types.js";

export const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";
export const DEFAULT_TASK_CHECK_TOOL_NAME = "task_check";

const summaryCheckpointControlTypes = new Set(SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES);

export function isSummaryCheckpointControlMessage(message = {}) {
  return summaryCheckpointControlTypes.has(readMessageField(message, "noobotInternalMessageType"));
}

function collectLatestInjectedMessageIndexes(messages = []) {
  const latest = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    if (!isInjectedMessage(message)) return;
    const type = resolveInjectedMessageType(message);
    if (!type) return;
    const owner = readMessageField(message, "injectedBy") || "injected";
    latest.set(`${owner}:${type}`, index);
  });
  return new Set(latest.values());
}

export function getModelMessageType(message = {}) {
  if (typeof message?._getType === "function") return String(message._getType() || "");
  return String(message?.lc_kwargs?.type || message?.type || "");
}

export function getMessageRole(message = {}) {
  const role = String(message?.role || "").trim();
  if (role) return role;
  const type = getModelMessageType(message).trim().toLowerCase();
  return ({ ai: "assistant", human: "user", system: "system", tool: "tool" })[type] || "";
}

export function resolveToolNameFromMessage(message = {}) {
  const explicit = String(message?.toolName || message?.tool_name || "").trim();
  if (explicit) return explicit;
  try {
    return String(JSON.parse(String(message?.content || ""))?.toolName || "").trim();
  } catch {
    return "";
  }
}

export function resolveToolNamesFromToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((call) => String(call?.name || call?.function?.name || "").trim())
    .filter(Boolean);
}

export function hasTaskSummaryToolCall(
  message = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return resolveToolNamesFromToolCalls(getMessageToolCalls(message)).includes(taskSummaryToolName);
}

function getTaskSummaryToolCallIds(
  message = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return getMessageToolCalls(message)
    .filter((call) => String(call?.name || call?.function?.name || "").trim() === taskSummaryToolName)
    .map((call) => String(call?.id || call?.tool_call_id || "").trim())
    .filter(Boolean);
}

export function isTaskSummaryToolMessage(
  message = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return resolveToolNameFromMessage(message) === taskSummaryToolName;
}

function isTaskSummaryMessage(message, options) {
  return hasTaskSummaryToolCall(message, options) || isTaskSummaryToolMessage(message, options);
}

function hasNamedToolCall(message = {}, toolName = "") {
  return resolveToolNamesFromToolCalls(getMessageToolCalls(message)).includes(toolName);
}

function isNamedToolMessage(message = {}, toolName = "") {
  return resolveToolNameFromMessage(message) === toolName;
}

function isNamedToolPairMessage(message = {}, toolName = "") {
  return hasNamedToolCall(message, toolName) || isNamedToolMessage(message, toolName);
}

function getNamedToolCallIds(message = {}, toolName = "") {
  return getMessageToolCalls(message)
    .filter((call) => String(call?.name || call?.function?.name || "").trim() === toolName)
    .map((call) => String(call?.id || call?.tool_call_id || "").trim())
    .filter(Boolean);
}

function collectLatestNamedToolMessageIndexes(messages = [], toolName = "") {
  const source = Array.isArray(messages) ? messages : [];
  const latest = new Set();
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (!isNamedToolPairMessage(message, toolName)) continue;
    latest.add(index);
    const toolCallId = String(message?.tool_call_id || message?.toolCallId || "").trim();
    if (isNamedToolMessage(message, toolName) && toolCallId) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (!getNamedToolCallIds(source[previous], toolName).includes(toolCallId)) continue;
        latest.add(previous);
        break;
      }
    }
    break;
  }
  return latest;
}

export function collectLatestTaskSummaryMessageIndexes(
  messages = [],
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  return collectLatestNamedToolMessageIndexes(messages, taskSummaryToolName);
}

export function collectLatestTaskCheckMessageIndexes(
  messages = [],
  { taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME } = {},
) {
  return collectLatestNamedToolMessageIndexes(messages, taskCheckToolName);
}

export function shouldMarkCurrentTurnSummarizedMessage(
  message = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (hasTaskSummaryToolCall(message, { taskSummaryToolName })) return false;
  if (isTaskSummaryToolMessage(message, { taskSummaryToolName })) return false;
  return shouldMarkCurrentTurnSummarizedByPolicy(message);
}

export const shouldMarkCurrentTurnSummarizedModelMessage =
  shouldMarkCurrentTurnSummarizedMessage;

export function shouldMarkCurrentTurnSummarizedMessageInScope(
  message = {},
  {
    messages = [],
    index = -1,
    latestInjectedIndexes = null,
    latestTaskSummaryIndexes = null,
    latestTaskCheckIndexes = null,
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  if (isSummaryCheckpointControlMessage(message)) return true;
  const injected = isInjectedMessage(message, policyOptions);
  const latestInjected = latestInjectedIndexes instanceof Set
    ? latestInjectedIndexes
    : collectLatestInjectedMessageIndexes(source, policyOptions);
  if (injected && latestInjected.has(index)) return false;
  if (injected) return true;
  if (isTaskSummaryMessage(message, { taskSummaryToolName })) {
    const latestSummary = latestTaskSummaryIndexes instanceof Set
      ? latestTaskSummaryIndexes
      : collectLatestTaskSummaryMessageIndexes(source, { taskSummaryToolName });
    if (latestSummary.has(index)) return false;
    return shouldMarkCurrentTurnSummarizedByPolicy(message);
  }
  if (isNamedToolPairMessage(message, taskCheckToolName)) {
    const latestTaskCheck = latestTaskCheckIndexes instanceof Set
      ? latestTaskCheckIndexes
      : collectLatestTaskCheckMessageIndexes(source, { taskCheckToolName });
    if (latestTaskCheck.has(index)) return false;
    return shouldMarkCurrentTurnSummarizedByPolicy(message);
  }
  return shouldMarkCurrentTurnSummarizedMessage(message, { taskSummaryToolName });
}

function summaryScope(messages, { taskSummaryToolName, taskCheckToolName, policyOptions }) {
  const source = Array.isArray(messages) ? messages : [];
  return {
    source,
    latestInjectedIndexes: collectLatestInjectedMessageIndexes(source, policyOptions),
    latestTaskSummaryIndexes: collectLatestTaskSummaryMessageIndexes(source, { taskSummaryToolName }),
    latestTaskCheckIndexes: collectLatestTaskCheckMessageIndexes(source, { taskCheckToolName }),
  };
}

function collectPreservedMessages(messages = [], indexes = new Set()) {
  const source = Array.isArray(messages) ? messages : [];
  const objects = new Set();
  const ids = new Set();
  for (const index of indexes instanceof Set ? indexes : []) {
    const message = source[index];
    if (!message || typeof message !== "object") continue;
    objects.add(message);
    const id = resolveMessageId(message);
    if (id) ids.add(id);
  }
  return { objects, ids };
}

function isPreservedMessage(message = {}, preserved = null) {
  if (!preserved) return false;
  if (preserved.objects instanceof Set && preserved.objects.has(message)) return true;
  const id = resolveMessageId(message);
  return Boolean(id && preserved.ids instanceof Set && preserved.ids.has(id));
}

function enforceToolCallBatchClosure(selectedMessages = [], source = [], retentionSource = []) {
  const selected = Array.isArray(selectedMessages) ? selectedMessages : [];
  const sourceMessages = Array.isArray(source) ? source : [];
  const retainedMessages = Array.isArray(retentionSource) ? retentionSource : sourceMessages;
  const selectedObjects = new Set(selected);
  const selectedIds = new Set(selected.map((message) => resolveMessageId(message)).filter(Boolean));
  const sourceObjects = new Set(sourceMessages);
  const sourceIds = new Set(sourceMessages.map((message) => resolveMessageId(message)).filter(Boolean));
  const blockedObjects = new Set();
  const blockedIds = new Set();
  const has = (objects, ids, message) => objects.has(message) ||
    Boolean(resolveMessageId(message) && ids.has(resolveMessageId(message)));
  const block = (message) => {
    if (!has(sourceObjects, sourceIds, message)) return;
    blockedObjects.add(message);
    const id = resolveMessageId(message);
    if (id) blockedIds.add(id);
  };

  const assistantBatches = [];
  const claimedToolResultIds = new Set();
  for (const message of retainedMessages) {
    if (resolveMessageRole(message) !== "assistant") continue;
    const calls = getMessageToolCalls(message);
    const callIds = calls.map(resolveToolCallId).filter(Boolean);
    if (!calls.length) continue;
    const resultMembers = retainedMessages.filter((candidate) =>
      resolveMessageRole(candidate) === "tool" &&
      callIds.includes(resolveToolCallId(candidate)),
    );
    for (const result of resultMembers) claimedToolResultIds.add(resolveToolCallId(result));
    assistantBatches.push({
      members: [message, ...resultMembers],
      complete: callIds.length === calls.length && callIds.every((id) =>
        resultMembers.some((result) => resolveToolCallId(result) === id),
      ),
    });
  }

  for (const batch of assistantBatches) {
    const allInSource = batch.members.every((message) => has(sourceObjects, sourceIds, message));
    const allSelected = batch.members.every((message) => has(selectedObjects, selectedIds, message));
    if (batch.complete && allInSource && allSelected) continue;
    for (const member of batch.members) block(member);
  }
  for (const message of retainedMessages) {
    if (resolveMessageRole(message) !== "tool") continue;
    const toolCallId = resolveToolCallId(message);
    if (toolCallId && !claimedToolResultIds.has(toolCallId)) block(message);
  }
  return selected.filter((message) => !blockedObjects.has(message) &&
    !(resolveMessageId(message) && blockedIds.has(resolveMessageId(message))));
}

export function collectClosedToolCallBatchMessages(messages = [], { retentionMessages = messages } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  return enforceToolCallBatchClosure(source, source, retentionMessages);
}

export function markCurrentTurnStoreSummarized(
  store = null,
  {
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
    onMarked = null,
  } = {},
) {
  if (!store || typeof store.updateWhere !== "function") return 0;
  const scoped = typeof store.toArray === "function" ? store.toArray() : [];
  const dimensions = summaryScope(scoped, { taskSummaryToolName, taskCheckToolName, policyOptions });
  return store.updateWhere({ summarized: true }, (message, index) => {
    const marked = shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: scoped,
      index,
      taskSummaryToolName,
      taskCheckToolName,
      policyOptions,
    });
    if (marked && typeof onMarked === "function") onMarked(message);
    return marked;
  });
}

export function mirrorSummarizedMessagesById(messages = [], messageIds = new Set()) {
  const ids = messageIds instanceof Set ? messageIds : new Set(messageIds);
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!ids.has(resolveMessageId(message))) continue;
    message.summarized = true;
    if (message?.lc_kwargs && typeof message.lc_kwargs === "object") {
      message.lc_kwargs.summarized = true;
    }
  }
}

export function markCurrentTurnArraySummarized(
  messages = [],
  {
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
  } = {},
) {
  const dimensions = summaryScope(messages, { taskSummaryToolName, taskCheckToolName, policyOptions });
  return dimensions.source.map((message, index) =>
    shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: dimensions.source,
      index,
      taskSummaryToolName,
      taskCheckToolName,
      policyOptions,
    }) ? { ...(message || {}), summarized: true } : message,
  );
}

export function markCurrentTurnModelMessagesSummarized(
  messages = [],
  {
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
  } = {},
) {
  const dimensions = summaryScope(messages, { taskSummaryToolName, taskCheckToolName, policyOptions });
  for (const [index, message] of dimensions.source.entries()) {
    if (!shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: dimensions.source,
      index,
      taskSummaryToolName,
      taskCheckToolName,
      policyOptions,
    })) continue;
    message.summarized = true;
    if (message?.lc_kwargs && typeof message.lc_kwargs === "object") message.lc_kwargs.summarized = true;
  }
}

export function collectScopedMessagesToSummarize(
  messages = [],
  {
    maxMessages = Number.POSITIVE_INFINITY,
    limitToProvidedMessagesOnly = false,
    retentionMessages = messages,
    taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME,
    taskCheckToolName = DEFAULT_TASK_CHECK_TOOL_NAME,
    policyOptions = {},
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const retentionSource = Array.isArray(retentionMessages) ? retentionMessages : source;
  const numericLimit = Number(maxMessages);
  const limit = Number.isFinite(numericLimit) && numericLimit >= 0
    ? Math.min(source.length, Math.floor(numericLimit))
    : source.length;
  const dimensions = summaryScope(source, { taskSummaryToolName, taskCheckToolName, policyOptions });
  const retentionDimensions = summaryScope(retentionSource, { taskSummaryToolName, taskCheckToolName, policyOptions });
  const preservedInjected = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestInjectedIndexes,
  );
  const preservedTaskSummaries = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestTaskSummaryIndexes,
  );
  const preservedTaskChecks = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestTaskCheckIndexes,
  );
  const selectedMessages = [];
  for (let index = 0; index < limit; index += 1) {
    const message = source[index];
    if (isSummaryCheckpointControlMessage(message)) {
      if (message?.summarized !== true && message?.lc_kwargs?.summarized !== true) {
        selectedMessages.push(message);
      }
      continue;
    }
    const injected = isInjectedMessage(message, policyOptions);
    if (injected) {
      if (isPreservedMessage(message, preservedInjected)) continue;
    } else if (isTaskSummaryMessage(message, { taskSummaryToolName })) {
      if (isPreservedMessage(message, preservedTaskSummaries)) continue;
      if (!shouldMarkCurrentTurnSummarizedByPolicy(message)) continue;
    } else if (isNamedToolPairMessage(message, taskCheckToolName)) {
      if (isPreservedMessage(message, preservedTaskChecks)) continue;
      if (!shouldMarkCurrentTurnSummarizedByPolicy(message)) continue;
    } else if (!shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: source,
      index,
      taskSummaryToolName,
      taskCheckToolName,
      policyOptions,
    })) {
      continue;
    }
    if (message?.summarized === true || message?.lc_kwargs?.summarized === true) continue;
    selectedMessages.push(message);
  }
  return {
    messages: enforceToolCallBatchClosure(selectedMessages, source, retentionSource),
    limitToProvidedMessagesOnly: limitToProvidedMessagesOnly === true,
  };
}

export function markScopedMessagesSummarized(messages = [], options = {}) {
  const selected = collectScopedMessagesToSummarize(messages, options);
  for (const message of selected.messages) {
    message.summarized = true;
    if (message?.lc_kwargs && typeof message.lc_kwargs === "object") message.lc_kwargs.summarized = true;
  }
  return {
    changedCount: selected.messages.length,
    limitToProvidedMessagesOnly: selected.limitToProvidedMessagesOnly,
  };
}

export function collectDialogScopedMessagesToSummarize(
  messages = [],
  { retentionMessages = messages, ...options } = {},
) {
  const sourceGroups = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const dialogProcessId = resolveMessageDialogProcessId(message);
    if (!dialogProcessId) {
      throw new Error("summary checkpoint message requires dialogProcessId");
    }
    const group = sourceGroups.get(dialogProcessId) || [];
    group.push(message);
    sourceGroups.set(dialogProcessId, group);
  }
  const retentionGroups = new Map();
  for (const message of Array.isArray(retentionMessages) ? retentionMessages : []) {
    const dialogProcessId = resolveMessageDialogProcessId(message);
    if (!dialogProcessId) {
      throw new Error("summary retention message requires dialogProcessId");
    }
    const group = retentionGroups.get(dialogProcessId) || [];
    group.push(message);
    retentionGroups.set(dialogProcessId, group);
  }
  return [...sourceGroups.entries()].flatMap(([dialogProcessId, group]) =>
    collectScopedMessagesToSummarize(group, {
      ...options,
      retentionMessages: retentionGroups.get(dialogProcessId) || group,
    }).messages,
  );
}

export function filterSummarizedMessages(messages = [], policyOptions = {}) {
  return filterForModelContext(messages, policyOptions);
}
