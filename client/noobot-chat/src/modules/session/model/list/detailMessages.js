/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../chat/model/chatConstants.js";
import {
  flattenSessionMessages,
  mergeAttachments,
  buildDialogProcessParentMap,
  resolveRootDialogProcessIdByChain,
} from "../../../chat/model/dialogProcessChain.js";
import {
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../../chat/model/messageIdentity.js";
import { getMessageAttachments } from "../../../chat/model/messageModel.js";
import { text } from "@noobot/shared/value";

export function buildNormalizedDetailMessages({
  detailMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  makeViewMessage,
} = {}) {
  const sourceMessages = Array.isArray(detailMessages) ? detailMessages : [];
  const normalizedMessages = sourceMessages.map((messageItem) => makeViewMessage(messageItem));
  for (const messageItem of normalizedMessages) {
    if (!messageItem.sessionId && rootSessionId) {
      messageItem.sessionId = rootSessionId;
    }
  }
  mergeChildTurnAttachmentsIntoRootMessages({
    rootMessages: normalizedMessages,
    sessionDocs,
    rootSessionId,
    makeViewMessage,
  });
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
      .filter(
        (messageItem) =>
          getMessageRole(messageItem) === RoleEnum.ASSISTANT && getMessageTurnScopeId(messageItem),
      )
      .map((messageItem) => getMessageDialogProcessId(messageItem))
      .filter(Boolean),
  );
  if (!rootDialogProcessIdSet.size) return output;
  const parentByDialogProcessId = buildDialogProcessParentMap(flattenSessionMessages(sessionDocs));
  for (const sessionDoc of Array.isArray(sessionDocs) ? sessionDocs : []) {
    const sessionId = text(sessionDoc?.sessionId);
    if (!sessionId || sessionId === text(rootSessionId)) continue;
    const messageList = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    for (const messageItem of messageList) {
      const normalizedAttachments = getMessageAttachments(makeViewMessage(messageItem));
      if (!normalizedAttachments.length) continue;
      const parentDialogProcessId = text(messageItem?.parentDialogProcessId);
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
  const childAttachmentsByParentDialogProcessId = buildChildAttachmentsByParentDialogProcessId({
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
    const childAttachments = childAttachmentsByParentDialogProcessId.get(dialogProcessId) || [];
    if (!childAttachments.length) continue;
    messageItem.attachments = mergeAttachments(
      getMessageAttachments(messageItem),
      childAttachments,
    );
  }
  return messages;
}
