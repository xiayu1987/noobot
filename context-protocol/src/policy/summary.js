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
} from "./message.js";
import { SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES } from "../message/injected-types.js";
import { FLOW_CONTROL_ROLE, hasFlowControlRole } from "../tool/context-policy.js";

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
  return { ai: "assistant", human: "user", system: "system", tool: "tool" }[type] || "";
}

function resolveToolCallName(call = {}) {
  return String(call?.name || call?.function?.name || "").trim();
}

function hasToolCallWithFlowControlRole(message = {}, role = "") {
  return getMessageToolCalls(message).some((call) => hasFlowControlRole(call, role));
}

function isToolResultWithFlowControlRole(message = {}, role = "") {
  return resolveMessageRole(message) === "tool" && hasFlowControlRole(message, role);
}

export function hasCheckpointBoundaryToolCall(message = {}) {
  return hasToolCallWithFlowControlRole(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
}

export function isCheckpointBoundaryToolMessage(message = {}) {
  return isToolResultWithFlowControlRole(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
}

function isFlowControlRoleMessage(message = {}, role = "") {
  return (
    hasToolCallWithFlowControlRole(message, role) || isToolResultWithFlowControlRole(message, role)
  );
}

function createToolCallBatchIndex(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const toolResultIndexesByCallId = new Map();
  for (const [index, message] of source.entries()) {
    if (resolveMessageRole(message) !== "tool") continue;
    const callId = resolveToolCallId(message);
    if (!callId) continue;
    const resultIndexes = toolResultIndexesByCallId.get(callId) || [];
    resultIndexes.push(index);
    toolResultIndexesByCallId.set(callId, resultIndexes);
  }

  const assistantBatches = [];
  for (const [index, message] of source.entries()) {
    if (resolveMessageRole(message) !== "assistant") continue;
    const calls = getMessageToolCalls(message);
    if (!calls.length) continue;
    const callIds = calls.map(resolveToolCallId).filter(Boolean);
    const resultIndexes = [
      ...new Set(callIds.flatMap((callId) => toolResultIndexesByCallId.get(callId) || [])),
    ].sort((left, right) => left - right);
    const batch = {
      assistantIndex: index,
      calls,
      callIds,
      resultIndexes,
      complete:
        callIds.length === calls.length &&
        callIds.every((callId) => toolResultIndexesByCallId.has(callId)),
    };
    assistantBatches.push(batch);
  }
  return { assistantBatches };
}

function collectLatestFlowControlMessageIndexesByToolIdentity(
  messages = [],
  role = "",
  toolBatchIndex = createToolCallBatchIndex(messages),
) {
  const indexes = new Set();
  const latestBatchByTool = new Map();
  for (const batch of toolBatchIndex.assistantBatches) {
    for (const call of batch.calls) {
      if (!hasFlowControlRole(call, role)) continue;
      const toolName = resolveToolCallName(call);
      if (toolName) latestBatchByTool.set(toolName, batch);
    }
  }
  for (const batch of latestBatchByTool.values()) {
    indexes.add(batch.assistantIndex);
    batch.resultIndexes.forEach((index) => indexes.add(index));
  }
  return indexes;
}

export function collectLatestCheckpointBoundaryMessageIndexes(messages = []) {
  return collectLatestFlowControlMessageIndexesByToolIdentity(
    messages,
    FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY,
  );
}

export function collectLatestCheckpointEvidenceMessageIndexes(messages = []) {
  return collectLatestFlowControlMessageIndexesByToolIdentity(
    messages,
    FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE,
  );
}

export function shouldMarkCurrentTurnSummarizedMessage(message = {}) {
  if (isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY)) return false;
  return shouldMarkCurrentTurnSummarizedByPolicy(message);
}

export const shouldMarkCurrentTurnSummarizedModelMessage = shouldMarkCurrentTurnSummarizedMessage;

export function shouldMarkCurrentTurnSummarizedMessageInScope(
  message = {},
  {
    messages = [],
    index = -1,
    latestInjectedIndexes = null,
    latestCheckpointBoundaryIndexes = null,
    latestCheckpointEvidenceIndexes = null,
    policyOptions = {},
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  if (isSummaryCheckpointControlMessage(message)) return true;
  const injected = isInjectedMessage(message, policyOptions);
  const latestInjected =
    latestInjectedIndexes instanceof Set
      ? latestInjectedIndexes
      : collectLatestInjectedMessageIndexes(source, policyOptions);
  if (injected && latestInjected.has(index)) return false;
  if (injected) return true;
  const latestBoundary =
    latestCheckpointBoundaryIndexes instanceof Set
      ? latestCheckpointBoundaryIndexes
      : collectLatestCheckpointBoundaryMessageIndexes(source);
  const latestEvidence =
    latestCheckpointEvidenceIndexes instanceof Set
      ? latestCheckpointEvidenceIndexes
      : collectLatestCheckpointEvidenceMessageIndexes(source);
  if (latestBoundary.has(index) || latestEvidence.has(index)) return false;
  if (isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY)) {
    return shouldMarkCurrentTurnSummarizedByPolicy(message);
  }
  if (isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE)) {
    return shouldMarkCurrentTurnSummarizedByPolicy(message);
  }
  return shouldMarkCurrentTurnSummarizedMessage(message);
}

function summaryScope(messages, { policyOptions }) {
  const source = Array.isArray(messages) ? messages : [];
  const toolBatchIndex = createToolCallBatchIndex(source);
  return {
    source,
    latestInjectedIndexes: collectLatestInjectedMessageIndexes(source, policyOptions),
    latestCheckpointBoundaryIndexes: collectLatestFlowControlMessageIndexesByToolIdentity(
      source,
      FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY,
      toolBatchIndex,
    ),
    latestCheckpointEvidenceIndexes: collectLatestFlowControlMessageIndexesByToolIdentity(
      source,
      FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE,
      toolBatchIndex,
    ),
    toolBatchIndex,
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

function enforceToolCallBatchClosure(
  selectedMessages = [],
  source = [],
  retentionSource = [],
  toolBatchIndex = createToolCallBatchIndex(retentionSource),
) {
  const selected = Array.isArray(selectedMessages) ? selectedMessages : [];
  const sourceMessages = Array.isArray(source) ? source : [];
  const retainedMessages = Array.isArray(retentionSource) ? retentionSource : sourceMessages;
  const selectedObjects = new Set(selected);
  const selectedIds = new Set(selected.map((message) => resolveMessageId(message)).filter(Boolean));
  const sourceObjects = new Set(sourceMessages);
  const sourceIds = new Set(
    sourceMessages.map((message) => resolveMessageId(message)).filter(Boolean),
  );
  const blockedObjects = new Set();
  const blockedIds = new Set();
  const has = (objects, ids, message) =>
    objects.has(message) ||
    Boolean(resolveMessageId(message) && ids.has(resolveMessageId(message)));
  const block = (message) => {
    if (!has(sourceObjects, sourceIds, message)) return;
    blockedObjects.add(message);
    const id = resolveMessageId(message);
    if (id) blockedIds.add(id);
  };

  const claimedToolResultIds = new Set();
  const assistantBatches = toolBatchIndex.assistantBatches.map((batch) => {
    const resultMembers = batch.resultIndexes.map((index) => retainedMessages[index]);
    for (const result of resultMembers) claimedToolResultIds.add(resolveToolCallId(result));
    return {
      members: [retainedMessages[batch.assistantIndex], ...resultMembers],
      complete: batch.complete,
    };
  });

  for (const batch of assistantBatches) {
    const allInSource = batch.members.every((message) => has(sourceObjects, sourceIds, message));
    const allSelected = batch.members.every((message) =>
      has(selectedObjects, selectedIds, message),
    );
    if (batch.complete && allInSource && allSelected) continue;
    for (const member of batch.members) block(member);
  }
  for (const message of retainedMessages) {
    if (resolveMessageRole(message) !== "tool") continue;
    const toolCallId = resolveToolCallId(message);
    if (toolCallId && !claimedToolResultIds.has(toolCallId)) block(message);
  }
  return selected.filter(
    (message) =>
      !blockedObjects.has(message) &&
      !(resolveMessageId(message) && blockedIds.has(resolveMessageId(message))),
  );
}

export function collectClosedToolCallBatchMessages(
  messages = [],
  { retentionMessages = messages } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const retainedMessages = Array.isArray(retentionMessages) ? retentionMessages : source;
  return enforceToolCallBatchClosure(
    source,
    source,
    retainedMessages,
    createToolCallBatchIndex(retainedMessages),
  );
}

export function markCurrentTurnStoreSummarized(
  store = null,
  { policyOptions = {}, onMarked = null } = {},
) {
  if (!store || typeof store.updateWhere !== "function") return 0;
  const scoped = typeof store.toArray === "function" ? store.toArray() : [];
  const dimensions = summaryScope(scoped, { policyOptions });
  return store.updateWhere({ summarized: true }, (message, index) => {
    const marked = shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: scoped,
      index,
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

export function markCurrentTurnArraySummarized(messages = [], { policyOptions = {} } = {}) {
  const dimensions = summaryScope(messages, { policyOptions });
  return dimensions.source.map((message, index) =>
    shouldMarkCurrentTurnSummarizedMessageInScope(message, {
      ...dimensions,
      messages: dimensions.source,
      index,
      policyOptions,
    })
      ? { ...(message || {}), summarized: true }
      : message,
  );
}

export function markCurrentTurnModelMessagesSummarized(messages = [], { policyOptions = {} } = {}) {
  const dimensions = summaryScope(messages, { policyOptions });
  for (const [index, message] of dimensions.source.entries()) {
    if (
      !shouldMarkCurrentTurnSummarizedMessageInScope(message, {
        ...dimensions,
        messages: dimensions.source,
        index,
        policyOptions,
      })
    )
      continue;
    message.summarized = true;
    if (message?.lc_kwargs && typeof message.lc_kwargs === "object")
      message.lc_kwargs.summarized = true;
  }
}

export function collectScopedMessagesToSummarize(
  messages = [],
  {
    maxMessages = Number.POSITIVE_INFINITY,
    limitToProvidedMessagesOnly = false,
    retentionMessages = messages,
    policyOptions = {},
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const retentionSource = Array.isArray(retentionMessages) ? retentionMessages : source;
  const numericLimit = Number(maxMessages);
  const limit =
    Number.isFinite(numericLimit) && numericLimit >= 0
      ? Math.min(source.length, Math.floor(numericLimit))
      : source.length;
  const dimensions = summaryScope(source, { policyOptions });
  const retentionDimensions = summaryScope(retentionSource, { policyOptions });
  const preservedInjected = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestInjectedIndexes,
  );
  const preservedCheckpointBoundaries = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestCheckpointBoundaryIndexes,
  );
  const preservedCheckpointEvidence = collectPreservedMessages(
    retentionSource,
    retentionDimensions.latestCheckpointEvidenceIndexes,
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
    } else if (isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY)) {
      if (isPreservedMessage(message, preservedCheckpointBoundaries)) continue;
      if (!shouldMarkCurrentTurnSummarizedByPolicy(message)) continue;
    } else if (isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE)) {
      if (isPreservedMessage(message, preservedCheckpointEvidence)) continue;
      if (!shouldMarkCurrentTurnSummarizedByPolicy(message)) continue;
    } else if (
      !shouldMarkCurrentTurnSummarizedMessageInScope(message, {
        ...dimensions,
        messages: source,
        index,
        policyOptions,
      })
    ) {
      continue;
    }
    if (message?.summarized === true || message?.lc_kwargs?.summarized === true) continue;
    selectedMessages.push(message);
  }
  return {
    messages: enforceToolCallBatchClosure(
      selectedMessages,
      source,
      retentionSource,
      retentionDimensions.toolBatchIndex,
    ),
    limitToProvidedMessagesOnly: limitToProvidedMessagesOnly === true,
  };
}

export function markScopedMessagesSummarized(messages = [], options = {}) {
  const selected = collectScopedMessagesToSummarize(messages, options);
  for (const message of selected.messages) {
    message.summarized = true;
    if (message?.lc_kwargs && typeof message.lc_kwargs === "object")
      message.lc_kwargs.summarized = true;
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
  return [...sourceGroups.entries()].flatMap(
    ([dialogProcessId, group]) =>
      collectScopedMessagesToSummarize(group, {
        ...options,
        retentionMessages: retentionGroups.get(dialogProcessId) || group,
      }).messages,
  );
}

export function filterSummarizedMessages(messages = [], policyOptions = {}) {
  return filterForModelContext(messages, policyOptions);
}
