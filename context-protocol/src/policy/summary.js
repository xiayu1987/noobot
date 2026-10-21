/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  isInjectedMessage,
  resolveInjectedMessageType,
  shouldMarkCurrentTurnSummarizedByPolicy,
} from "./message.js";
import {
  markContextMessageSummarized,
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageId,
  resolveContextMessageRole,
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
  resolveContextMessageSummarized,
} from "../message/codec.js";
import { SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES } from "../message/injected-types.js";
import { projectSessionRecordToContextMessage } from "../message/session-projection.js";
import { isContextControlMessage } from "./injected-message.js";
import {
  FLOW_CONTROL_ROLE,
  hasContextMessageFlowControlRole,
  hasToolCallFlowControlRole,
} from "../tool/context-policy.js";
import { text, isObjectLike } from "@noobot/shared/value";
import { resolveSessionMessageRecordDialogProcessId } from "@noobot/session-protocol";

const summaryAlwaysRetainedInjectedTypes = new Set(SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES);

function collectRetainedInjectedMessageIndexes(messages = []) {
  const latest = new Map();
  const retained = new Set();
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    if (!isInjectedMessage(message)) return;
    const type = resolveInjectedMessageType(message);
    if (!type) return;
    if (summaryAlwaysRetainedInjectedTypes.has(type)) {
      retained.add(index);
      return;
    }
    const owner = readContextMessageField(message, "injectedBy") || "injected";
    latest.set(`${owner}:${type}`, index);
  });
  for (const index of latest.values()) retained.add(index);
  return retained;
}

function resolveToolCallName(call = {}) {
  return text(call?.name || call?.function?.name);
}

function hasToolCallWithFlowControlRole(message = {}, role = "") {
  return resolveContextToolCalls(message).some((call) => hasToolCallFlowControlRole(call, role));
}

function isToolResultWithFlowControlRole(message = {}, role = "") {
  return (
    resolveContextMessageRole(message) === "tool" && hasContextMessageFlowControlRole(message, role)
  );
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
    if (resolveContextMessageRole(message) !== "tool") continue;
    const callId = resolveContextToolResultCallId(message);
    if (!callId) continue;
    const resultIndexes = toolResultIndexesByCallId.get(callId) || [];
    resultIndexes.push(index);
    toolResultIndexesByCallId.set(callId, resultIndexes);
  }

  const assistantBatches = [];
  for (const [index, message] of source.entries()) {
    if (resolveContextMessageRole(message) !== "assistant") continue;
    const calls = resolveContextToolCalls(message);
    if (!calls.length) continue;
    const callIds = calls.map(resolveContextToolCallDeclarationId).filter(Boolean);
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
      if (!hasToolCallFlowControlRole(call, role)) continue;
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

export function shouldMarkCurrentTurnSummarizedMessageInScope(
  message = {},
  {
    messages = [],
    index = -1,
    retainedInjectedIndexes = null,
    latestCheckpointBoundaryIndexes = null,
    latestCheckpointEvidenceIndexes = null,
    policyOptions = {},
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  if (isContextControlMessage(message)) return true;
  const injected = isInjectedMessage(message, policyOptions);
  const retainedInjected =
    retainedInjectedIndexes instanceof Set
      ? retainedInjectedIndexes
      : collectRetainedInjectedMessageIndexes(source, policyOptions);
  if (injected && retainedInjected.has(index)) return false;
  if (injected) return true;
  if (
    isLatestCheckpointMessageIndex(source, index, {
      latestCheckpointBoundaryIndexes,
      latestCheckpointEvidenceIndexes,
    })
  )
    return false;
  if (
    isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY) ||
    isFlowControlRoleMessage(message, FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE)
  ) {
    return shouldMarkCurrentTurnSummarizedByPolicy(message);
  }
  return shouldMarkCurrentTurnSummarizedMessage(message);
}

function isLatestCheckpointMessageIndex(
  source,
  index,
  { latestCheckpointBoundaryIndexes, latestCheckpointEvidenceIndexes },
) {
  const latestBoundary =
    latestCheckpointBoundaryIndexes instanceof Set
      ? latestCheckpointBoundaryIndexes
      : collectLatestCheckpointBoundaryMessageIndexes(source);
  if (latestBoundary.has(index)) return true;
  const latestEvidence =
    latestCheckpointEvidenceIndexes instanceof Set
      ? latestCheckpointEvidenceIndexes
      : collectLatestCheckpointEvidenceMessageIndexes(source);
  return latestEvidence.has(index);
}

function summaryScope(messages, { policyOptions }) {
  const source = Array.isArray(messages) ? messages : [];
  const toolBatchIndex = createToolCallBatchIndex(source);
  return {
    source,
    retainedInjectedIndexes: collectRetainedInjectedMessageIndexes(source, policyOptions),
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
    if (!isObjectLike(message)) continue;
    objects.add(message);
    const id = resolveContextMessageId(message);
    if (id) ids.add(id);
  }
  return { objects, ids };
}

function isPreservedMessage(message = {}, preserved = null) {
  if (!preserved) return false;
  if (preserved.objects instanceof Set && preserved.objects.has(message)) return true;
  const id = resolveContextMessageId(message);
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
  const selectedIds = new Set(
    selected.map((message) => resolveContextMessageId(message)).filter(Boolean),
  );
  const sourceObjects = new Set(sourceMessages);
  const sourceIds = new Set(
    sourceMessages.map((message) => resolveContextMessageId(message)).filter(Boolean),
  );
  const blockedObjects = new Set();
  const blockedIds = new Set();
  const has = (objects, ids, message) =>
    objects.has(message) ||
    Boolean(resolveContextMessageId(message) && ids.has(resolveContextMessageId(message)));
  const block = (message) => {
    if (!has(sourceObjects, sourceIds, message)) return;
    blockedObjects.add(message);
    const id = resolveContextMessageId(message);
    if (id) blockedIds.add(id);
  };

  const claimedToolResultIds = new Set();
  const assistantBatches = toolBatchIndex.assistantBatches.map((batch) => {
    const resultMembers = batch.resultIndexes.map((index) => retainedMessages[index]);
    for (const result of resultMembers)
      claimedToolResultIds.add(resolveContextToolResultCallId(result));
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
    if (resolveContextMessageRole(message) !== "tool") continue;
    const toolCallId = resolveContextToolResultCallId(message);
    if (toolCallId && !claimedToolResultIds.has(toolCallId)) block(message);
  }
  return selected.filter(
    (message) =>
      !blockedObjects.has(message) &&
      !(resolveContextMessageId(message) && blockedIds.has(resolveContextMessageId(message))),
  );
}

function collectClosedToolCallBatchMessages(messages = [], { retentionMessages = messages } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const retainedMessages = Array.isArray(retentionMessages) ? retentionMessages : source;
  return enforceToolCallBatchClosure(
    source,
    source,
    retainedMessages,
    createToolCallBatchIndex(retainedMessages),
  );
}

export function resolveSummaryScope(
  messageBlocks = {},
  { messageIds = null, policyOptions = {} } = {},
) {
  const blocks = messageBlocks && typeof messageBlocks === "object" ? messageBlocks : {};
  const history = Array.isArray(blocks.history) ? blocks.history : [];
  const incremental = Array.isArray(blocks.incremental) ? blocks.incremental : [];
  const sourceMessages = [...history, ...incremental];
  const checkpointMessages = collectClosedToolCallBatchMessages(sourceMessages, {
    retentionMessages: sourceMessages,
  });
  const wantedIds = Array.isArray(messageIds)
    ? new Set(messageIds.map((id) => text(id)).filter(Boolean))
    : null;
  const selectedCheckpointMessages = wantedIds
    ? checkpointMessages.filter((message) => wantedIds.has(resolveContextMessageId(message)))
    : checkpointMessages;
  const summaryMessages = collectDialogScopedMessagesToSummarize(selectedCheckpointMessages, {
    maxMessages: selectedCheckpointMessages.length,
    limitToProvidedMessagesOnly: true,
    retentionMessages: sourceMessages,
    policyOptions,
  });
  return Object.freeze({
    history,
    incremental,
    sourceMessages,
    checkpointMessages,
    summaryMessages,
  });
}

export function collectCurrentTurnSummarizedMessageIndexes(
  messages = [],
  { policyOptions = {} } = {},
) {
  const dimensions = summaryScope(messages, { policyOptions });
  const indexes = new Set();
  dimensions.source.forEach((message, index) => {
    if (
      shouldMarkCurrentTurnSummarizedMessageInScope(message, {
        ...dimensions,
        messages: dimensions.source,
        index,
        policyOptions,
      })
    ) {
      indexes.add(index);
    }
  });
  return indexes;
}

function collectRecordSummarizedIndexes(records = [], policyOptions = {}) {
  return collectCurrentTurnSummarizedMessageIndexes(
    records.map(projectSessionRecordToContextMessage),
    { policyOptions },
  );
}

export function markCurrentTurnStoreSummarized(turnMessageStore, { policyOptions = {} } = {}) {
  const indexes = collectRecordSummarizedIndexes(turnMessageStore.toArray(), policyOptions);
  const markedMessageIds = new Set();
  const markedCount = turnMessageStore.updateWhere({ summarized: true }, (record, index) => {
    if (!indexes.has(index)) return false;
    markedMessageIds.add(text(record.messageUid));
    return true;
  });
  return { markedCount, markedMessageIds };
}

export function markCurrentTurnArraySummarized(records = [], { policyOptions = {} } = {}) {
  const indexes = collectRecordSummarizedIndexes(records, policyOptions);
  return records.map((record, index) =>
    indexes.has(index) ? { ...record, summarized: true } : record,
  );
}

export function mirrorSummarizedMessagesById(messages = [], messageIds = new Set()) {
  const ids = messageIds instanceof Set ? messageIds : new Set(messageIds);
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!ids.has(resolveContextMessageId(message))) continue;
    markContextMessageSummarized(message);
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
    retentionDimensions.retainedInjectedIndexes,
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
    if (isContextControlMessage(message)) {
      if (!resolveContextMessageSummarized(message)) {
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
    if (resolveContextMessageSummarized(message)) continue;
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
    markContextMessageSummarized(message);
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
    const dialogProcessId = resolveContextMessageDialogProcessId(message);
    if (!dialogProcessId) {
      throw new Error("summary checkpoint message requires dialogProcessId");
    }
    const group = sourceGroups.get(dialogProcessId) || [];
    group.push(message);
    sourceGroups.set(dialogProcessId, group);
  }
  const retentionGroups = new Map();
  for (const message of Array.isArray(retentionMessages) ? retentionMessages : []) {
    const dialogProcessId = resolveContextMessageDialogProcessId(message);
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

function collectTurnMessageOwnership(messages = []) {
  const allMessageUids = new Set();
  const ownedByTurn = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const messageUid = text(message?.messageUid);
    allMessageUids.add(messageUid);
    const key = `${resolveSessionMessageRecordDialogProcessId(message)}\u0000${text(message?.turnScopeId)}`;
    const owned = ownedByTurn.get(key) || new Set();
    owned.add(messageUid);
    ownedByTurn.set(key, owned);
  }
  return { allMessageUids, ownedByTurn };
}

function isSummaryReceiptLive(receipt, owned, allMessageUids) {
  if (!isObjectLike(receipt)) return false;
  const persisted = Array.isArray(receipt.persistedMessageUids) ? receipt.persistedMessageUids : [];
  const summarized = Array.isArray(receipt.summarizedMessageUids)
    ? receipt.summarizedMessageUids
    : [];
  return (
    persisted.every((uid) => owned.has(text(uid))) &&
    summarized.every((uid) => allMessageUids.has(text(uid)))
  );
}

function normalizeCheckpointUidList(values) {
  return [
    ...new Set((Array.isArray(values) ? values : []).map((uid) => text(uid)).filter(Boolean)),
  ];
}

function normalizeSummaryReceipt(receipt) {
  if (!isObjectLike(receipt) || Array.isArray(receipt)) return null;
  const checkpointId = text(receipt.checkpointId);
  const requestHash = text(receipt.requestHash);
  if (!checkpointId || !requestHash) return null;
  return {
    checkpointId,
    checkpointRevision: Math.max(0, Number(receipt.checkpointRevision) || 0),
    requestHash,
    persistedMessageUids: normalizeCheckpointUidList(receipt.persistedMessageUids),
    summarizedMessageUids: normalizeCheckpointUidList(receipt.summarizedMessageUids),
    retainedMessageUids: normalizeCheckpointUidList(receipt.retainedMessageUids),
    markedCount: Math.max(0, Number(receipt.markedCount) || 0),
    committedAt: text(receipt.committedAt),
  };
}

export function normalizeTurnSummaryCheckpoints(checkpoints = {}) {
  if (!isObjectLike(checkpoints) || Array.isArray(checkpoints)) return {};
  const normalized = {};
  for (const value of Object.values(checkpoints)) {
    if (!isObjectLike(value) || Array.isArray(value)) continue;
    const turnScopeId = text(value.turnScopeId);
    const dialogProcessId = text(value.dialogProcessId);
    if (!turnScopeId || !dialogProcessId) continue;
    normalized[turnScopeId] = {
      dialogProcessId,
      turnScopeId,
      checkpointRevision: Math.max(0, Number(value.checkpointRevision) || 0),
      receipts: (Array.isArray(value.receipts) ? value.receipts : [])
        .map(normalizeSummaryReceipt)
        .filter(Boolean)
        .slice(-50),
    };
  }
  return normalized;
}

export function pruneTurnSummaryCheckpoints(checkpoints = {}, messages = []) {
  const { allMessageUids, ownedByTurn } = collectTurnMessageOwnership(messages);
  const pruned = {};
  for (const [turnScopeId, state] of Object.entries(normalizeTurnSummaryCheckpoints(checkpoints))) {
    const owned = ownedByTurn.get(`${state.dialogProcessId}\u0000${turnScopeId}`);
    if (!owned) continue;
    pruned[turnScopeId] = {
      ...state,
      receipts: state.receipts.filter((receipt) =>
        isSummaryReceiptLive(receipt, owned, allMessageUids),
      ),
    };
  }
  return pruned;
}
