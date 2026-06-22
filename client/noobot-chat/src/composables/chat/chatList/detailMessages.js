/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  buildDialogProcessParentMap,
  flattenSessionMessages,
  mergeAttachmentMetas,
  resolveRootDialogProcessIdByChain,
} from "../../infra/dialogProcessChain";

const IN_FLIGHT_CHANNEL_STATES = new Set([
  "sending",
  "reconnecting",
  "interaction_pending",
  "stopping",
]);

function preserveRunningThinkingState(existingMessage = {}, detailMessageItem = {}) {
  const existingChannelState =
    existingMessage?.channelState &&
    typeof existingMessage.channelState === "object" &&
    !Array.isArray(existingMessage.channelState)
      ? existingMessage.channelState
      : null;
  const existingThinkingStartedAt = String(
    existingMessage?.thinkingStartedAt || existingMessage?.thinking_started_at || "",
  ).trim();
  const existingThinkingFinishedAt = String(
    existingMessage?.thinkingFinishedAt || existingMessage?.thinking_finished_at || "",
  ).trim();
  const existingPending = existingMessage?.pending === true;
  return () => {
    if (existingChannelState && !detailMessageItem?.channelState) {
      existingMessage.channelState = existingChannelState;
    }
    if (existingThinkingStartedAt && !String(detailMessageItem?.thinkingStartedAt || detailMessageItem?.thinking_started_at || "").trim()) {
      existingMessage.thinkingStartedAt = existingThinkingStartedAt;
      existingMessage.thinking_started_at = existingThinkingStartedAt;
    }
    if (existingThinkingFinishedAt && !String(detailMessageItem?.thinkingFinishedAt || detailMessageItem?.thinking_finished_at || "").trim()) {
      existingMessage.thinkingFinishedAt = existingThinkingFinishedAt;
      existingMessage.thinking_finished_at = existingThinkingFinishedAt;
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
    String(messageItem?.dialogProcessId || "").trim(),
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
  return normalizeMessageContent(messageItem?.role);
}

export function buildMessageIdentity(messageItem = {}) {
  return [
    normalizeMessageRole(messageItem),
    normalizeMessageContent(messageItem?.dialogProcessId || messageItem?.dialogId),
    normalizeMessageContent(messageItem?.content),
  ].join("|");
}

export function findExistingMessageIndexForDetailMessage(existingMessages = [], detailMessageItem = {}) {
  const detailRole = normalizeMessageRole(detailMessageItem);
  const detailDialogProcessId = normalizeMessageContent(
    detailMessageItem?.dialogProcessId || detailMessageItem?.dialogId,
  );
  const detailContent = normalizeMessageContent(detailMessageItem?.content);
  if (!detailRole || (!detailDialogProcessId && !detailContent)) return -1;
  const identity = buildMessageIdentity(detailMessageItem);
  const exactIndex = existingMessages.findIndex(
    (messageItem) => buildMessageIdentity(messageItem) === identity,
  );
  if (exactIndex >= 0) return exactIndex;
  if (detailDialogProcessId) {
    const dialogIndex = existingMessages.findIndex(
      (messageItem) =>
        normalizeMessageRole(messageItem) === detailRole &&
        normalizeMessageContent(messageItem?.dialogProcessId || messageItem?.dialogId) ===
          detailDialogProcessId,
    );
    if (dialogIndex >= 0) return dialogIndex;
  }
  if (detailRole === RoleEnum.USER && detailContent) {
    for (let index = existingMessages.length - 1; index >= 0; index -= 1) {
      const messageItem = existingMessages[index];
      if (normalizeMessageRole(messageItem) !== RoleEnum.USER) continue;
      if (normalizeMessageContent(messageItem?.content) !== detailContent) continue;
      return index;
    }
  }
  return -1;
}

export function mergePreservedDetailMessages(existingMessages = [], detailMessages = []) {
  if (!Array.isArray(existingMessages) || !Array.isArray(detailMessages) || !detailMessages.length) {
    return;
  }
  const appendedIdentities = new Set(existingMessages.map((messageItem) => buildMessageIdentity(messageItem)));
  for (const detailMessageItem of detailMessages) {
    if (detailMessageItem?.workflowMessage === true) continue;
    const detailIdentity = buildMessageIdentity(detailMessageItem);
    const existingIndex = findExistingMessageIndexForDetailMessage(existingMessages, detailMessageItem);
    if (existingIndex >= 0) {
      const existingMessage = existingMessages[existingIndex];
      const thinkingOpenNames = Array.isArray(existingMessage?.thinkingOpenNames)
        ? existingMessage.thinkingOpenNames
        : [];
      const restoreRunningThinkingState = preserveRunningThinkingState(
        existingMessage,
        detailMessageItem,
      );
      Object.assign(existingMessage, detailMessageItem);
      if (thinkingOpenNames.length) existingMessage.thinkingOpenNames = thinkingOpenNames;
      existingMessage.pending = false;
      restoreRunningThinkingState();
      appendedIdentities.add(detailIdentity);
      continue;
    }
    if (!detailIdentity || appendedIdentities.has(detailIdentity)) continue;
    existingMessages.push(detailMessageItem);
    appendedIdentities.add(detailIdentity);
  }
}

export function buildChildAttachmentMetasByParentDialogProcessId({
  sessionDocs = [],
  rootSessionId = "",
  rootMessages = [],
  makeViewMessage,
} = {}) {
  const output = new Map();
  const rootDialogProcessIdSet = new Set(
    (Array.isArray(rootMessages) ? rootMessages : [])
      .filter((messageItem) => String(messageItem?.role || "") === RoleEnum.ASSISTANT)
      .map((messageItem) => String(messageItem?.dialogProcessId || "").trim())
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
      const attachmentMetas = Array.isArray(messageItem?.attachmentMetas)
        ? messageItem.attachmentMetas
        : [];
      if (!attachmentMetas.length) continue;
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
      const normalizedAttachmentMetas =
        makeViewMessage({ attachmentMetas }).attachmentMetas || [];
      const mergedAttachmentMetas = mergeAttachmentMetas(
        output.get(rootDialogProcessId) || [],
        normalizedAttachmentMetas,
      );
      output.set(rootDialogProcessId, mergedAttachmentMetas);
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
  const childAttachmentMetasByParentDialogProcessId =
    buildChildAttachmentMetasByParentDialogProcessId({
      sessionDocs,
      rootSessionId,
      rootMessages: messages,
      makeViewMessage,
    });
  if (!childAttachmentMetasByParentDialogProcessId.size) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (String(messageItem?.role || "") !== RoleEnum.ASSISTANT) continue;
    const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    if (!dialogProcessId) continue;
    const childAttachmentMetas =
      childAttachmentMetasByParentDialogProcessId.get(dialogProcessId) || [];
    if (!childAttachmentMetas.length) continue;
    messageItem.attachmentMetas = mergeAttachmentMetas(
      messageItem?.attachmentMetas || [],
      childAttachmentMetas,
    );
  }
  return messages;
}

export function applySummaryToolLogs(sessionItem, sessionDocs = []) {
  const logsByDialogProcessId = new Map();
  for (const sessionDoc of sessionDocs) {
    for (const logItem of Array.isArray(sessionDoc?.toolLogSummaries) ? sessionDoc.toolLogSummaries : []) {
      const dialogProcessId = String(logItem?.dialogProcessId || "").trim();
      if (!dialogProcessId) continue;
      logsByDialogProcessId.set(dialogProcessId, [
        ...(logsByDialogProcessId.get(dialogProcessId) || []),
        logItem,
      ]);
    }
  }
  for (const messageItem of sessionItem.messages || []) {
    if (String(messageItem?.role || "") !== RoleEnum.ASSISTANT) continue;
    const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    messageItem.completedToolLogs = logsByDialogProcessId.get(dialogProcessId) || [];
  }
}
