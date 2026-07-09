/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  buildDialogProcessParentMap,
  flattenSessionMessages,
  mergeAttachments,
  resolveRootDialogProcessIdByChain,
} from "../../infra/dialogProcessChain";
import {
  buildMessageIdentityKey,
  canUseTurnScopedAssets,
  clearTurnScopedAssets,
  findMessageIdentityIndex,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../infra/messageIdentity";
import {
  getThinkingFinishedAt,
  getThinkingStartedAt,
  resolveTimeIso,
  setThinkingFinishedAt,
  setThinkingStartedAt,
} from "../../infra/timeFields";
import { getMessageAttachments } from "../../infra/messageModel";
import {
  getMessageRuntimeChannelState,
  isMessageInFlightAssistant,
  resolveSessionRunMessageRuntimeView,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../sessionRunStateMachine";
import {
  logResendDebug,
  summarizeDebugMessage,
} from "../debug/resendDebugLogger";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../debug/stateMachineLogger";

const TERMINAL_STOP_CHANNEL_STATES = new Set([
  "user_stopped",
  "cancelled",
  "aborted",
]);

const FINALIZED_ASSISTANT_STATES = new Set([
  "completed",
  "frontend_completed",
  "user_stopped",
  "cancelled",
  "aborted",
  "error",
  "expired",
  "no_conversation",
]);

function normalizeState(value = "") {
  return String(value || "").trim().toLowerCase();
}

function countCompletedToolLogAttachments(messageItem = {}) {
  return (Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : [])
    .reduce((total, logItem) => total + (Array.isArray(logItem?.attachments) ? logItem.attachments.length : 0), 0);
}

function isInFlightAssistantMessage(messageItem = {}) {
  return isMessageInFlightAssistant(messageItem);
}

function isTerminalStopAssistantDetail(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const states = [
    messageItem?.stopState,
    messageItem?.status,
    messageItem?.state,
    getMessageRuntimeChannelState(messageItem)?.state,
  ].map(normalizeState);
  return states.some((state) => TERMINAL_STOP_CHANNEL_STATES.has(state));
}

function hasReliableCompletedAssistantIdentity(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  if (messageItem?.workflowMessage === true) return false;
  if (isInFlightAssistantMessage(messageItem)) return false;
  if (isTerminalStopAssistantDetail(messageItem)) return false;
  return Boolean(getMessageTurnScopeId(messageItem) || getMessageDialogProcessId(messageItem));
}

function isFinalizedAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const state = normalizeState(
    getMessageRuntimeChannelState(messageItem)?.state ||
      messageItem?.status ||
      messageItem?.state ||
      messageItem?.stopState,
  );
  return messageItem?.pending === false && FINALIZED_ASSISTANT_STATES.has(state);
}

function snapshotFrozenAssistantDisplayFields(messageItem = {}) {
  return {
    content: messageItem?.content,
    ts: messageItem?.ts,
    timestamp: messageItem?.timestamp,
    createdAt: messageItem?.createdAt,
    created_at: messageItem?.created_at,
    updatedAt: messageItem?.updatedAt,
    updated_at: messageItem?.updated_at,
    thinkingStartedAt: getThinkingStartedAt(messageItem),
    thinkingFinishedAt: getThinkingFinishedAt(messageItem),
    channelState:
      messageItem?.channelState && typeof messageItem.channelState === "object" && !Array.isArray(messageItem.channelState)
        ? { ...messageItem.channelState }
        : messageItem?.channelState,
    status: messageItem?.status,
    state: messageItem?.state,
    stopState: messageItem?.stopState,
  };
}

function restoreFrozenAssistantDisplayFields(messageItem = {}, frozen = null) {
  if (!messageItem || !frozen) return;
  ["content", "ts", "timestamp", "createdAt", "created_at", "updatedAt", "updated_at", "status", "state", "stopState"].forEach((key) => {
    if (frozen[key] !== undefined) messageItem[key] = frozen[key];
  });
  if (frozen.thinkingStartedAt) setThinkingStartedAt(messageItem, frozen.thinkingStartedAt);
  if (frozen.thinkingFinishedAt) setThinkingFinishedAt(messageItem, frozen.thinkingFinishedAt);
  if (frozen.channelState !== undefined) messageItem.channelState = frozen.channelState;
  messageItem.pending = false;
}

function resolveTurnTimingKey(item = {}) {
  return getMessageTurnScopeId(item) || getMessageDialogProcessId(item) || "";
}

function buildTurnTimingMap(turnTimings = []) {
  const map = new Map();
  for (const item of Array.isArray(turnTimings) ? turnTimings : []) {
    const key = resolveTurnTimingKey(item);
    if (!key) continue;
    map.set(key, {
      thinkingStartedAt: resolveTimeIso(item?.thinkingStartedAt),
      thinkingFinishedAt: resolveTimeIso(item?.thinkingFinishedAt),
    });
  }
  return map;
}

function applyTurnTimingsToMessages(messages = [], turnTimings = []) {
  const timingMap = buildTurnTimingMap(turnTimings);
  if (!timingMap.size) return messages;
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    const timing = timingMap.get(resolveTurnTimingKey(messageItem));
    if (!timing) continue;
    if (timing.thinkingStartedAt) setThinkingStartedAt(messageItem, timing.thinkingStartedAt);
    if (timing.thinkingFinishedAt) setThinkingFinishedAt(messageItem, timing.thinkingFinishedAt);
  }
  return messages;
}

function conflictsWithInFlightAssistant(existingMessages = [], detailMessageItem = {}) {
  const detailTurnScopeId = getMessageTurnScopeId(detailMessageItem);
  const detailDialogProcessId = getMessageDialogProcessId(detailMessageItem);
  return (Array.isArray(existingMessages) ? existingMessages : []).some((messageItem) => {
    if (!isInFlightAssistantMessage(messageItem)) return false;
    const existingTurnScopeId = getMessageTurnScopeId(messageItem);
    const existingDialogProcessId = getMessageDialogProcessId(messageItem);
    if (detailTurnScopeId && existingTurnScopeId) return detailTurnScopeId === existingTurnScopeId;
    if (detailDialogProcessId && existingDialogProcessId) return detailDialogProcessId === existingDialogProcessId;
    return false;
  });
}

function preserveRunningThinkingState(existingMessage = {}, detailMessageItem = {}) {
  const existingChannelState =
    existingMessage?.channelState &&
    typeof existingMessage.channelState === "object" &&
    !Array.isArray(existingMessage.channelState)
      ? existingMessage.channelState
      : null;
  const existingThinkingStartedAt = getThinkingStartedAt(existingMessage);
  const existingThinkingFinishedAt = getThinkingFinishedAt(existingMessage);
  const existingPending = existingMessage?.pending === true;
  return () => {
    if (existingChannelState && !detailMessageItem?.channelState) {
      existingMessage.channelState = existingChannelState;
    }
    if (existingThinkingStartedAt && !getThinkingStartedAt(detailMessageItem)) {
      setThinkingStartedAt(existingMessage, existingThinkingStartedAt);
    }
    if (existingThinkingFinishedAt && !getThinkingFinishedAt(detailMessageItem)) {
      setThinkingFinishedAt(existingMessage, existingThinkingFinishedAt);
    }
    const runtimeView = resolveSessionRunMessageRuntimeView(existingMessage);
    if (existingPending && runtimeView.inFlightAssistant) {
      existingMessage.pending = true;
    }
  };
}

export function buildWorkflowMessageSignature(messageItem = {}) {
  const workflowMeta =
    messageItem?.workflowMeta &&
    typeof messageItem.workflowMeta === "object" &&
    !Array.isArray(messageItem.workflowMeta)
      ? messageItem.workflowMeta
      : {};
  const semanticPreview = String(
    workflowMeta?.semanticTextPreview ||
      workflowMeta?.payload?.interaction?.semanticTextPreview ||
      "",
  ).trim();
  return [
    getMessageDialogProcessId(messageItem),
    String(messageItem?.content || "").trim(),
    semanticPreview,
  ].join("|");
}

export function patchExistingWorkflowMessage(existingMessage = null, workflowMessageItem = {}) {
  if (!existingMessage || !workflowMessageItem) return false;
  const thinkingOpenNames = Array.isArray(existingMessage?.thinkingOpenNames)
    ? existingMessage.thinkingOpenNames
    : [];
  Object.assign(existingMessage, workflowMessageItem);
  existingMessage.pending = false;
  existingMessage.workflowMessage = true;
  if (thinkingOpenNames.length) existingMessage.thinkingOpenNames = thinkingOpenNames;
  return true;
}

export function normalizeMessageContent(value = "") {
  return String(value || "").trim();
}

export function normalizeMessageRole(messageItem = {}) {
  return getMessageRole(messageItem);
}

export function buildMessageIdentity(messageItem = {}) {
  return buildMessageIdentityKey(messageItem);
}

function isInlineEditingUserMessage(messageItem = {}) {
  return (
    normalizeMessageRole(messageItem) === RoleEnum.USER &&
    messageItem?.__monotonicEditing === true
  );
}

export function findExistingMessageIndexForDetailMessage(existingMessages = [], detailMessageItem = {}) {
  if (buildMessageIdentity(detailMessageItem)) {
    return findMessageIdentityIndex(detailMessageItem, existingMessages);
  }
  const detailRole = normalizeMessageRole(detailMessageItem);
  const detailDialogProcessId = getMessageDialogProcessId(detailMessageItem);
  if (detailDialogProcessId) {
    const matchingDialogIndexes = existingMessages
      .map((messageItem, index) => ({ messageItem, index }))
      .filter(({ messageItem }) => {
        if (normalizeMessageRole(messageItem) !== detailRole) return false;
        if (buildMessageIdentity(messageItem)) return false;
        return getMessageDialogProcessId(messageItem) === detailDialogProcessId;
      })
      .map(({ index }) => index);
    if (matchingDialogIndexes.length === 1) return matchingDialogIndexes[0];
  }
  if (detailRole !== RoleEnum.USER) return -1;
  const matchingUserIndexes = existingMessages
    .map((messageItem, index) => ({ messageItem, index }))
    .filter(({ messageItem }) => {
      if (normalizeMessageRole(messageItem) !== RoleEnum.USER) return false;
      return !buildMessageIdentity(messageItem);
    })
    .map(({ index }) => index);
  return matchingUserIndexes.length === 1 ? matchingUserIndexes[0] : -1;
}

export function mergePreservedDetailMessages(existingMessages = [], detailMessages = []) {
  if (!Array.isArray(existingMessages) || !Array.isArray(detailMessages) || !detailMessages.length) {
    return;
  }
  for (const detailMessageItem of detailMessages) {
    if (detailMessageItem?.workflowMessage === true) continue;
    const detailIdentity = buildMessageIdentity(detailMessageItem);
    const existingIndex = findExistingMessageIndexForDetailMessage(existingMessages, detailMessageItem);
    if (existingIndex >= 0) {
      const existingMessage = existingMessages[existingIndex];
      logResendDebug("detail.merge.match", {
        identity: detailIdentity,
        existingIndex,
        existing: summarizeDebugMessage(existingMessage),
        detail: summarizeDebugMessage(detailMessageItem),
      });
      if (
        isInFlightAssistantMessage(existingMessage) &&
        isTerminalStopAssistantDetail(detailMessageItem)
      ) {
        logResendDebug("detail.merge.skipStoppedOverInFlight", {
          identity: detailIdentity,
          existingIndex,
          existing: summarizeDebugMessage(existingMessage),
          detail: summarizeDebugMessage(detailMessageItem),
        });
        continue;
      }
      const keepInlineEditingContent = isInlineEditingUserMessage(existingMessage);
      const inlineEditingContent = keepInlineEditingContent
        ? existingMessage.content
        : undefined;
      const thinkingOpenNames = Array.isArray(existingMessage?.thinkingOpenNames)
        ? existingMessage.thinkingOpenNames
        : [];
      const runtimeStateMark = existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK];
      const runtimeMark = existingMessage?.runtimeMark;
      const existingAttachments = getMessageAttachments(existingMessage);
      const detailAttachments = getMessageAttachments(detailMessageItem);
      const completedToolLogAttachmentsBefore = countCompletedToolLogAttachments(existingMessage);
      const completedToolLogAttachmentsDetail = countCompletedToolLogAttachments(detailMessageItem);
      const restoreRunningThinkingState = preserveRunningThinkingState(
        existingMessage,
        detailMessageItem,
      );
      const frozenAssistantDisplayFields = isFinalizedAssistantMessage(existingMessage)
        ? snapshotFrozenAssistantDisplayFields(existingMessage)
        : null;
      Object.assign(existingMessage, detailMessageItem);
      logResendDebug("detail.merge.assign", {
        identity: detailIdentity,
        existingIndex,
        before: summarizeDebugMessage({ ...existingMessage, ...detailMessageItem }),
        detail: summarizeDebugMessage(detailMessageItem),
      });
      if (keepInlineEditingContent) {
        existingMessage.content = inlineEditingContent;
        existingMessage.__monotonicEditing = true;
      }
      if (existingAttachments.length || detailAttachments.length) {
        existingMessage.attachments = detailAttachments.length
          ? mergeAttachments(existingAttachments, detailAttachments)
          : existingAttachments;
      }
      if (thinkingOpenNames.length) existingMessage.thinkingOpenNames = thinkingOpenNames;
      if (runtimeStateMark && !existingMessage[SESSION_RUN_MESSAGE_RUNTIME_MARK]) {
        existingMessage[SESSION_RUN_MESSAGE_RUNTIME_MARK] = runtimeStateMark;
      }
      if (runtimeMark && !existingMessage.runtimeMark) {
        existingMessage.runtimeMark = runtimeMark;
      }
      restoreFrozenAssistantDisplayFields(existingMessage, frozenAssistantDisplayFields);
      const attachmentsAfter = getMessageAttachments(existingMessage);
      const completedToolLogAttachmentsAfter = countCompletedToolLogAttachments(existingMessage);
      logStateMachineDebug("detailApply.merge.runtimeAndAttachments", {
        identity: detailIdentity,
        existingIndex,
        message: summarizeStateMachineMessage(existingMessage),
        hasRuntimeMarkBefore: Boolean(runtimeStateMark || runtimeMark),
        hasRuntimeMarkAfter: Boolean(existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || existingMessage?.runtimeMark),
        runtimeMarkPreserved: Boolean((runtimeStateMark && existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK]) || (runtimeMark && existingMessage?.runtimeMark)),
        attachmentsCountBefore: existingAttachments.length,
        attachmentsCountDetail: detailAttachments.length,
        attachmentsCountAfter: attachmentsAfter.length,
        completedToolLogAttachmentsCountBefore: completedToolLogAttachmentsBefore,
        completedToolLogAttachmentsCountDetail: completedToolLogAttachmentsDetail,
        completedToolLogAttachmentsCountAfter: completedToolLogAttachmentsAfter,
      });
      existingMessage.pending = false;
      restoreRunningThinkingState();
      continue;
    }
    if (
      hasReliableCompletedAssistantIdentity(detailMessageItem) &&
      !conflictsWithInFlightAssistant(existingMessages, detailMessageItem)
    ) {
      existingMessages.push(detailMessageItem);
    } else {
      logStateMachineDebug("detailApply.merge.notAppended", {
        identity: detailIdentity,
        detail: summarizeStateMachineMessage(detailMessageItem),
        attachmentsCountDetail: getMessageAttachments(detailMessageItem).length,
        completedToolLogAttachmentsCountDetail: countCompletedToolLogAttachments(detailMessageItem),
        hasReliableCompletedAssistantIdentity: hasReliableCompletedAssistantIdentity(detailMessageItem),
        conflictsWithInFlightAssistant: conflictsWithInFlightAssistant(existingMessages, detailMessageItem),
      });
    }
  }
}

export function buildNormalizedDetailMessages({
  detailMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  turnTimings = [],
  makeViewMessage,
  foldMessagesForView,
  isSummaryDetail = false,
} = {}) {
  const sourceMessages = Array.isArray(detailMessages) ? detailMessages : [];
  const normalizedMessages = isSummaryDetail
    ? sourceMessages.map((messageItem) => makeViewMessage(messageItem))
    : foldMessagesForView(sourceMessages);
  if (!isSummaryDetail) {
    mergeChildTurnAttachmentsIntoRootMessages({
      rootMessages: normalizedMessages,
      sessionDocs,
      rootSessionId,
      makeViewMessage,
    });
  }
  applyTurnTimingsToMessages(normalizedMessages, turnTimings);
  return normalizedMessages;
}

export function buildChildAttachmentsByParentDialogProcessId({
  sessionDocs = [],
  rootSessionId = "",
  rootMessages = [],
  makeViewMessage,
} = {}) {
  const output = new Map();
  const rootDialogProcessIdSet = new Set(
    (Array.isArray(rootMessages) ? rootMessages : [])
      .filter((messageItem) =>
        getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
        getMessageTurnScopeId(messageItem),
      )
      .map((messageItem) => getMessageDialogProcessId(messageItem))
      .filter(Boolean),
  );
  if (!rootDialogProcessIdSet.size) return output;
  const parentByDialogProcessId = buildDialogProcessParentMap(
    flattenSessionMessages(sessionDocs),
  );
  for (const sessionDoc of Array.isArray(sessionDocs) ? sessionDocs : []) {
    const sessionId = String(sessionDoc?.sessionId || "").trim();
    if (!sessionId || sessionId === String(rootSessionId || "").trim()) continue;
    const messageList = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    for (const messageItem of messageList) {
      const normalizedAttachments = getMessageAttachments(makeViewMessage(messageItem));
      if (!normalizedAttachments.length) continue;
      const parentDialogProcessId = String(
        messageItem?.parentDialogProcessId || "",
      ).trim();
      if (!parentDialogProcessId) continue;
      const rootDialogProcessId = resolveRootDialogProcessIdByChain({
        startDialogProcessId: parentDialogProcessId,
        rootDialogProcessIdSet,
        parentByDialogProcessId,
      });
      if (!rootDialogProcessId) continue;
      const mergedAttachments = mergeAttachments(
        output.get(rootDialogProcessId) || [],
        normalizedAttachments,
      );
      output.set(rootDialogProcessId, mergedAttachments);
    }
  }
  return output;
}

export function mergeChildTurnAttachmentsIntoRootMessages({
  rootMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  makeViewMessage,
} = {}) {
  const messages = Array.isArray(rootMessages) ? rootMessages : [];
  if (!messages.length) return messages;
  const childAttachmentsByParentDialogProcessId =
    buildChildAttachmentsByParentDialogProcessId({
      sessionDocs,
      rootSessionId,
      rootMessages: messages,
      makeViewMessage,
    });
  if (!childAttachmentsByParentDialogProcessId.size) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    if (isAssistantWithoutTurnScope(messageItem)) {
      clearTurnScopedAssets(messageItem);
      continue;
    }
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!dialogProcessId) continue;
    const childAttachments =
      childAttachmentsByParentDialogProcessId.get(dialogProcessId) || [];
    if (!childAttachments.length) continue;
    messageItem.attachments = mergeAttachments(
      getMessageAttachments(messageItem),
      childAttachments,
    );
  }
  return messages;
}

export function applySummaryToolLogs(sessionItem, sessionDocs = []) {
  const logsByDialogProcessId = new Map();
  const logsByTurnScopeId = new Map();
  let hasTurnScopedLogs = false;
  for (const sessionDoc of sessionDocs) {
    for (const logItem of Array.isArray(sessionDoc?.toolLogSummaries) ? sessionDoc.toolLogSummaries : []) {
      const turnScopeId = getMessageTurnScopeId(logItem);
      if (turnScopeId) {
        hasTurnScopedLogs = true;
        logsByTurnScopeId.set(turnScopeId, [
          ...(logsByTurnScopeId.get(turnScopeId) || []),
          logItem,
        ]);
      }
      const dialogProcessId = getMessageDialogProcessId(logItem);
      if (!dialogProcessId) continue;
      logsByDialogProcessId.set(dialogProcessId, [
        ...(logsByDialogProcessId.get(dialogProcessId) || []),
        logItem,
      ]);
    }
  }
  for (const messageItem of sessionItem.messages || []) {
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    if (!canUseTurnScopedAssets(messageItem)) {
      clearTurnScopedAssets(messageItem);
      continue;
    }
    const turnScopeId = getMessageTurnScopeId(messageItem);
    if (logsByTurnScopeId.has(turnScopeId)) {
      messageItem.completedToolLogs = logsByTurnScopeId.get(turnScopeId) || [];
      continue;
    }
    if (hasTurnScopedLogs) {
      messageItem.completedToolLogs = [];
      continue;
    }
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    messageItem.completedToolLogs = logsByDialogProcessId.get(dialogProcessId) || [];
  }
}
