/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../chat/model/chatConstants.js";
import {
  buildDialogProcessParentMap,
  flattenSessionMessages,
  mergeAttachments,
  resolveRootDialogProcessIdByChain,
} from "../../../chat/model/dialogProcessChain.js";
import {
  canUseTurnScopedAssets,
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
  normalizeTurnScopeIdKey,
} from "../../../chat/model/messageIdentity.js";
import { getMessageAttachments } from "../../../chat/model/messageModel.js";

export function buildTurnStatusesByTurnScopeId({ turnStatuses = [] } = {}) {
  return Object.fromEntries(
    (Array.isArray(turnStatuses) ? turnStatuses : [])
      .map((item = {}) => [normalizeTurnScopeIdKey(getMessageTurnScopeId(item)), item])
      .filter(([turnScopeId]) => Boolean(turnScopeId)),
  );
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export function buildNormalizedDetailMessages({
  detailMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  turnTimings = [],
  turnStatuses = [],
  makeViewMessage,
} = {}) {
  const sourceMessages = Array.isArray(detailMessages) ? detailMessages : [];
  const normalizedMessages = sourceMessages.map((messageItem) => makeViewMessage(messageItem));
  for (const messageItem of normalizedMessages) {
    if (!messageItem.sessionId && rootSessionId) {
      messageItem.sessionId = rootSessionId;
      messageItem.session_id = rootSessionId;
    }
  }
  mergeChildTurnAttachmentsIntoRootMessages({
    rootMessages: normalizedMessages,
    sessionDocs,
    rootSessionId,
    makeViewMessage,
  });
  applyStatusTurnScopeIds({
    messages: normalizedMessages,
    sessionDocs,
    turnStatuses,
  });
  return normalizedMessages;
}

export function applyStatusTurnScopeIds({ messages = [], sessionDocs = [], turnStatuses = [] } = {}) {
  const statusByDialogProcessId = new Map(
    (Array.isArray(turnStatuses) ? turnStatuses : [])
      .map((status) => [
        normalizeText(status?.dialogProcessId || getMessageDialogProcessId(status)),
        status,
      ])
      .filter(([dialogProcessId, status]) => dialogProcessId && normalizeText(status?.turnScopeId)),
  );
  if (!statusByDialogProcessId.size) return messages;
  const allMessages = [
    ...(Array.isArray(messages) ? messages : []),
    ...flattenSessionMessages(sessionDocs),
  ];
  const parentByDialogProcessId = buildDialogProcessParentMap(allMessages);
  const rootDialogProcessIdSet = new Set(statusByDialogProcessId.keys());
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!dialogProcessId) continue;
    const rootDialogProcessId = rootDialogProcessIdSet.has(dialogProcessId)
      ? dialogProcessId
      : resolveRootDialogProcessIdByChain({
        startDialogProcessId: dialogProcessId,
        rootDialogProcessIdSet,
        parentByDialogProcessId,
      });
    const turnStatus = statusByDialogProcessId.get(rootDialogProcessId);
    const statusTurnScopeId = normalizeText(turnStatus?.turnScopeId);
    if (statusTurnScopeId) {
      messageItem.statusTurnScopeId = statusTurnScopeId;
      messageItem.persistedStatusStepState = normalizeText(turnStatus?.status);
    }
  }
  return messages;
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
