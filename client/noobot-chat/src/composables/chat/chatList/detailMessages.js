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
  setThinkingFinishedAt,
  setThinkingStartedAt,
} from "../../infra/timeFields";
import { getMessageAttachments } from "../../infra/messageModel";
import {
  logResendDebug,
  summarizeDebugMessage,
} from "../debug/resendDebugLogger";

const IN_FLIGHT_CHANNEL_STATES = new Set([
  "sending",
  "reconnecting",
  "interaction_pending",
  "stopping",
]);

const TERMINAL_STOP_CHANNEL_STATES = new Set([
  "stopped",
  "cancelled",
  "canceled",
  "aborted",
]);

function normalizeState(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isInFlightAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  if (messageItem?.pending === true) return true;
  const channelState = normalizeState(messageItem?.channelState?.state || messageItem?.channel_state?.state);
  return IN_FLIGHT_CHANNEL_STATES.has(channelState);
}

function isTerminalStopAssistantDetail(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const states = [
    messageItem?.stopState,
    messageItem?.status,
    messageItem?.state,
    messageItem?.channelState?.state,
    messageItem?.channel_state?.state,
  ].map(normalizeState);
  return states.some((state) => TERMINAL_STOP_CHANNEL_STATES.has(state));
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
    const channelState = String(existingMessage?.channelState?.state || "").trim();
    if (existingPending && IN_FLIGHT_CHANNEL_STATES.has(channelState)) {
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
  if (!buildMessageIdentity(detailMessageItem)) return -1;
  return findMessageIdentityIndex(detailMessageItem, existingMessages);
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
      const existingAttachments = getMessageAttachments(existingMessage);
      const detailAttachments = getMessageAttachments(detailMessageItem);
      const restoreRunningThinkingState = preserveRunningThinkingState(
        existingMessage,
        detailMessageItem,
      );
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
      existingMessage.pending = false;
      restoreRunningThinkingState();
      continue;
    }
  }
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
