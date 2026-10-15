/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "./chatConstants.js";
import {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  mergeTransferEnvelopes,
} from "./transferEnvelopes.js";
import { getMessageAttachments } from "./messageModel.js";
import {
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "./messageIdentity.js";
import { parseTimeMs } from "./timeFields.js";
import { isAuthoritativeTerminalState } from "../runtime/sessionRunStateMachine.js";
import { hydrateTurnSnapshot } from "../runtime/engine/turnProjectionStore.js";
import { text } from "@noobot/shared/value";

function isSessionEntryRunning(sessionEntry = {}) {
  const sessionId = text(sessionEntry?.sessionId);
  const snapshot = sessionEntry?.replayBatch?.snapshot || {};
  const activeTurn = snapshot?.activeTurn || snapshot?.payload?.activeTurn || {};
  const activeTurnSessionId = text(activeTurn?.sessionId || snapshot?.sessionId);
  const activeTurnScopeId = text(activeTurn?.turnScopeId);
  const activeTurnState = text(activeTurn?.state);
  if (!activeTurnState || isAuthoritativeTerminalState(activeTurnState)) return false;
  return Boolean(sessionId && activeTurnSessionId === sessionId && activeTurnScopeId);
}

function hasPendingInteractions(sessionEntry = {}) {
  return (
    Array.isArray(sessionEntry?.replayBatch?.pendingInteractions) &&
    sessionEntry.replayBatch.pendingInteractions.length > 0
  );
}

function isDialogProcessRecoverable(sessionEntry = {}) {
  if (isSessionEntryRunning(sessionEntry)) return true;
  return hasPendingInteractions(sessionEntry);
}

function findRecoverableReconnectSessionId(sessionsPayload = [], preferredSessionId = "") {
  const preferred = text(preferredSessionId);
  if (preferred) {
    const preferredEntry = (Array.isArray(sessionsPayload) ? sessionsPayload : []).find(
      (sessionEntry) => text(sessionEntry?.sessionId) === preferred,
    );

    if (preferredEntry) return preferred;
  }
  for (const sessionEntry of Array.isArray(sessionsPayload) ? sessionsPayload : []) {
    const sessionId = text(sessionEntry?.sessionId);
    if (!sessionId) continue;
    if (isSessionEntryRunning(sessionEntry)) return sessionId;
    if (hasPendingInteractions(sessionEntry)) return sessionId;
  }
  return "";
}

function getLastUserMessageIndex(messages = []) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (getMessageRole(messages[messageIndex]) === RoleEnum.USER) {
      return messageIndex;
    }
  }
  return -1;
}

function findLatestPendingAssistantAfterLastUser(messages = []) {
  const lastUserMessageIndex = getLastUserMessageIndex(messages);
  for (
    let messageIndex = messages.length - 1;
    messageIndex > lastUserMessageIndex;
    messageIndex -= 1
  ) {
    const messageItem = messages[messageIndex];
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    if (!messageItem?.pending) continue;
    return messageItem;
  }
  return null;
}

function normalizeMessageContentForCompare(content = "") {
  return text(content);
}

function hasArrayItems(value = null) {
  return Array.isArray(value) && value.length > 0;
}

function mergeReplayTransferEnvelopes(...values) {
  return mergeTransferEnvelopes(...values);
}

function messageCompareKey(messageItem = {}) {
  const role = getMessageRole(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const content = normalizeMessageContentForCompare(messageItem?.content || "");
  if (role === RoleEnum.USER) {
    const attachmentKey = getMessageAttachments(messageItem)
      .map((attachmentItem) =>
        [attachmentItem?.name, attachmentItem?.attachmentId, attachmentItem?.size]
          .map((item) => text(item))
          .join(":"),
      )
      .join(",");
    return `${role}|${content}|${attachmentKey}`;
  }
  return `${role}|${turnScopeId}|${dialogProcessId}|${content}`;
}

function parseMessageTimeMs(value) {
  return parseTimeMs(value);
}

function mergeCurrentUserMessagesIntoFoldedMessages({
  foldedMessages = [],
  existingMessages = [],
} = {}) {
  const outputMessages = Array.isArray(foldedMessages) ? [...foldedMessages] : [];
  const currentMessages = Array.isArray(existingMessages) ? existingMessages : [];
  const existingKeys = new Set(outputMessages.map((messageItem) => messageCompareKey(messageItem)));
  for (const currentMessage of currentMessages) {
    if (getMessageRole(currentMessage) !== RoleEnum.USER) continue;
    const currentKey = messageCompareKey(currentMessage);
    if (existingKeys.has(currentKey)) continue;
    outputMessages.push(currentMessage);
    existingKeys.add(currentKey);
  }
  outputMessages.sort((leftMessage, rightMessage) => {
    const leftTime = parseMessageTimeMs(leftMessage?.ts);
    const rightTime = parseMessageTimeMs(rightMessage?.ts);
    if (leftTime && rightTime && leftTime !== rightTime) return leftTime - rightTime;
    if (
      getMessageRole(leftMessage) === RoleEnum.USER &&
      getMessageRole(rightMessage) === RoleEnum.ASSISTANT
    ) {
      return -1;
    }
    if (
      getMessageRole(leftMessage) === RoleEnum.ASSISTANT &&
      getMessageRole(rightMessage) === RoleEnum.USER
    ) {
      return 1;
    }
    return 0;
  });
  return outputMessages;
}

function findReusableMessageObject(nextMessage = {}, existingMessages = []) {
  const nextRole = getMessageRole(nextMessage);
  if (nextRole === RoleEnum.ASSISTANT) {
    const presentationMessageId = text(nextMessage?.presentationMessageId);
    if (!presentationMessageId) return null;
    return (
      existingMessages.find(
        (existingMessage) =>
          getMessageRole(existingMessage) === RoleEnum.ASSISTANT &&
          text(existingMessage?.presentationMessageId) === presentationMessageId,
      ) || null
    );
  }

  const nextKey = messageCompareKey(nextMessage);
  return (
    existingMessages.find((existingMessage) => messageCompareKey(existingMessage) === nextKey) ||
    null
  );
}

const NON_TURN_MESSAGE_PATCH_FIELDS = Object.freeze([
  "id",
  "messageId",
  "role",
  "type",
  "sessionId",
  "dialogProcessId",
  "processId",
  "content",
  "attachments",
  "modelRuns",
  "tool_calls",
  "modelAlias",
  "modelName",
  "createdAt",
  "updatedAt",
  "ts",
]);

function patchNonTurnMessageMetadata(targetMessage = {}, sourceMessage = {}) {
  for (const field of NON_TURN_MESSAGE_PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(sourceMessage, field)) continue;
    targetMessage[field] = sourceMessage[field];
  }
}

function patchMessageObjectPreservingUiState(
  targetMessage = {},
  sourceMessage = {},
  turnStatus = null,
) {
  const sourceRole = getMessageRole(sourceMessage);
  const sourceTurnScopeId = getMessageTurnScopeId(sourceMessage);

  const sourceAssistantWithoutTurnScope = sourceRole === RoleEnum.ASSISTANT && !sourceTurnScopeId;
  const existingTurnScopeId = getMessageTurnScopeId(targetMessage);
  if (sourceAssistantWithoutTurnScope && existingTurnScopeId) return targetMessage;
  const existingContent = String(targetMessage?.content || "");
  const existingAttachments = getMessageAttachments(targetMessage);
  const existingModelRuns = Array.isArray(targetMessage?.modelRuns) ? targetMessage.modelRuns : [];
  const existingTransferEnvelopes = getMessageTransferEnvelopes(targetMessage);
  const sourceTransferEnvelopes = getMessageTransferEnvelopes(sourceMessage);
  const exactTurnSnapshot = Boolean(
    sourceTurnScopeId &&
    sourceTurnScopeId === getMessageTurnScopeId(targetMessage) &&
    text(sourceMessage?.sessionId) === text(targetMessage?.sessionId),
  );
  if (exactTurnSnapshot) {
    hydrateTurnSnapshot({
      targetMessage,
      snapshot: sourceMessage,
      throughSequence: Number(
        sourceMessage?.throughSequence || sourceMessage?.messageEventState?.lastSequence || 0,
      ),
    });
  } else {
    patchNonTurnMessageMetadata(targetMessage, sourceMessage);
    if (existingContent.trim() && !text(sourceMessage?.content)) {
      targetMessage.content = existingContent;
    }
    if (existingAttachments.length && !getMessageAttachments(sourceMessage).length) {
      targetMessage.attachments = existingAttachments;
    }
    if (existingModelRuns.length && !hasArrayItems(sourceMessage?.modelRuns)) {
      targetMessage.modelRuns = existingModelRuns;
    }
  }
  const mergedTransferEnvelopes = mergeReplayTransferEnvelopes(
    existingTransferEnvelopes,
    sourceTransferEnvelopes,
  );
  if (mergedTransferEnvelopes.length) {
    targetMessage.transferEnvelopes = mergedTransferEnvelopes;
    const transferAttachments = getMessageTransferAttachments(targetMessage);
    const existingAttachmentKeys = new Set(
      (Array.isArray(targetMessage.attachments) ? targetMessage.attachments : [])
        .map((item) => text(item?.attachmentId || item?.identity?.attachmentId))
        .filter(Boolean),
    );
    targetMessage.attachments = [
      ...(Array.isArray(targetMessage.attachments) ? targetMessage.attachments : []),
      ...transferAttachments.filter((item) => {
        const key = text(item?.attachmentId || item?.identity?.attachmentId);
        if (!key || existingAttachmentKeys.has(key)) return false;
        existingAttachmentKeys.add(key);
        return true;
      }),
    ];
  }
  if (sourceAssistantWithoutTurnScope) {
    clearTurnScopedAssets(targetMessage);
    delete targetMessage.turnScopeId;
  }
  return targetMessage;
}

export {
  findLatestPendingAssistantAfterLastUser,
  findRecoverableReconnectSessionId,
  findReusableMessageObject,
  isDialogProcessRecoverable,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
};
