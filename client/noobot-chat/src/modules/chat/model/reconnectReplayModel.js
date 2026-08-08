/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "./chatConstants.js";
import {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  normalizeTransferEnvelopes,
} from "./transferEnvelopes.js";
import { getMessageAttachments } from "./messageModel.js";
import {
  canUseTurnScopedAssets,
  clearTurnScopedAssets,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  hasMessageTurnScopeConflict,
} from "./messageIdentity.js";
import { parseTimeMs } from "./timeFields.js";
import {
  isAuthoritativeTerminalState,
  resolveSessionRunMessageRuntimeView,
} from "../runtime/sessionRunStateMachine.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { hydrateTurnSnapshot } from "../runtime/engine/turnProjectionStore.js";
import { isPendingInteractionReplay } from "@noobot/event-protocol";

function isReconnectTerminalEvent(eventName = "") {
  return [
    StreamEventEnum.DONE,
    StreamEventEnum.USER_STOPPED,
    StreamEventEnum.ERROR,
  ].includes(String(eventName || "").trim());
}

function isSessionEntryRunning(sessionEntry = {}) {
  const sessionId = String(sessionEntry?.sessionId || "").trim();
  const snapshot = sessionEntry?.replayBatch?.snapshot || {};
  const activeTurn = snapshot?.activeTurn || snapshot?.payload?.activeTurn || {};
  const activeTurnSessionId = String(activeTurn?.sessionId || snapshot?.sessionId || "").trim();
  const activeTurnScopeId = String(activeTurn?.turnScopeId || "").trim();
  const activeTurnState = String(activeTurn?.state || "").trim();
  if (!activeTurnState || isAuthoritativeTerminalState(activeTurnState)) return false;
  return Boolean(
    sessionId &&
    activeTurnSessionId === sessionId &&
    activeTurnScopeId,
  );
}

function hasPendingInteractions(sessionEntry = {}) {
  return Array.isArray(sessionEntry?.replayBatch?.pendingInteractions) &&
    sessionEntry.replayBatch.pendingInteractions.length > 0;
}

function isDialogProcessRecoverable(sessionEntry = {}) {
  if (isSessionEntryRunning(sessionEntry)) return true;
  return hasPendingInteractions(sessionEntry);
}

function findRecoverableReconnectSessionId(sessionsPayload = [], preferredSessionId = "") {
  const preferred = String(preferredSessionId || "").trim();
  if (preferred) {
    const preferredEntry = (Array.isArray(sessionsPayload) ? sessionsPayload : [])
      .find((sessionEntry) => String(sessionEntry?.sessionId || "").trim() === preferred);
    if (preferredEntry && isDialogProcessRecoverable(preferredEntry)) return preferred;
  }
  for (const sessionEntry of Array.isArray(sessionsPayload) ? sessionsPayload : []) {
    const sessionId = String(sessionEntry?.sessionId || "").trim();
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

function getReconnectEnvelopeSequence(envelope = {}) {
  return Number(envelope?.data?.seq || envelope?.sequence || 0);
}

function splitReconnectMessagesByTurnIdentity(
  messages = [],
  fallbackDialogProcessId = "",
) {
  const normalizedFallback = String(fallbackDialogProcessId || "").trim();
  const groups = new Map();
  for (const envelope of Array.isArray(messages) ? messages : []) {
    const envelopeDpId = String(envelope?.data?.dialogProcessId || "").trim();
    const turnScopeId = String(
      envelope?.data?.turnScopeId || envelope?.data?.messageEvent?.turnScopeId || "",
    ).trim();
    const dialogProcessId = envelopeDpId || normalizedFallback;
    const groupKey = JSON.stringify([dialogProcessId, turnScopeId]);
    if (!groups.has(groupKey)) groups.set(groupKey, { dialogProcessId, turnScopeId, messages: [] });
    groups.get(groupKey).messages.push(envelope);
  }
  return Array.from(groups.values());
}

const splitReconnectMessagesByDialogProcessId = splitReconnectMessagesByTurnIdentity;

function resolveDialogProcessIdFromReplay(messages = [], fallbackDialogProcessId = "") {
  const fallback = String(fallbackDialogProcessId || "").trim();
  if (fallback) return fallback;
  const matchedEnvelope = (Array.isArray(messages) ? messages : []).find((envelope) =>
    String(envelope?.data?.dialogProcessId || "").trim(),
  );
  return String(matchedEnvelope?.data?.dialogProcessId || "").trim();
}

function isReconnectTerminalBatch(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((envelope) =>
    isReconnectTerminalEvent(envelope?.event || ""),
  );
}

function findReconnectDoneEnvelopeWithMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).find(
    (envelope) =>
      String(envelope?.event || "").trim() === StreamEventEnum.DONE &&
      Array.isArray(envelope?.data?.messages) &&
      envelope.data.messages.length,
  );
}

function getReconnectMaxSequence(messages = [], fallbackSeq = 0) {
  return (Array.isArray(messages) ? messages : []).reduce(
    (maxSeq, envelope) => Math.max(maxSeq, getReconnectEnvelopeSequence(envelope)),
    Number(fallbackSeq || 0),
  );
}

function collectReconnectDeltaText(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.DELTA)
    .map((envelope) => String(envelope?.data?.text || ""))
    .join("");
}

function normalizeMessageContentForCompare(content = "") {
  return String(content || "").trim();
}

function getArrayItems(value = null) {
  return Array.isArray(value) ? value : [];
}

const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

function hasArrayItems(value = null) {
  return Array.isArray(value) && value.length > 0;
}

function buildTransferEnvelopeKey(envelope = {}) {
  return [
    envelope?.protocol,
    envelope?.version,
    envelope?.transferId,
    envelope?.messageId,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("::");
}

function mergeTransferEnvelopes(...values) {
  const merged = [];
  const seen = new Set();
  for (const value of values) {
    for (const envelope of normalizeTransferEnvelopes(value)) {
      const key = buildTransferEnvelopeKey(envelope) || JSON.stringify(envelope);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(envelope);
    }
  }
  return merged;
}

function messageCompareKey(messageItem = {}) {
  const role = getMessageRole(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const content = normalizeMessageContentForCompare(messageItem?.content || "");
  if (role === RoleEnum.USER) {
    const attachmentKey = getMessageAttachments(messageItem)
      .map((attachmentItem) =>
        [
          attachmentItem?.name,
          attachmentItem?.attachmentId,
          attachmentItem?.size,
        ]
          .map((item) => String(item || "").trim())
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
    const presentationMessageId = String(nextMessage?.presentationMessageId || "").trim();
    if (!presentationMessageId) return null;
    return existingMessages.find(
      (existingMessage) =>
        getMessageRole(existingMessage) === RoleEnum.ASSISTANT &&
        String(existingMessage?.presentationMessageId || "").trim() === presentationMessageId,
    ) || null;
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

function patchMessageObjectPreservingUiState(targetMessage = {}, sourceMessage = {}, turnStatus = null) {
  const sourceRole = getMessageRole(sourceMessage);
  const sourceTurnScopeId = getMessageTurnScopeId(sourceMessage);
  const sourceCanUseTurnScopedAssets = canUseTurnScopedAssets(sourceMessage);
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
    String(sourceMessage?.sessionId || "").trim() === String(targetMessage?.sessionId || "").trim(),
  );
  if (exactTurnSnapshot) {
    hydrateTurnSnapshot({
      targetMessage,
      snapshot: sourceMessage,
      throughSequence: Number(sourceMessage?.throughSequence || sourceMessage?.messageEventState?.lastSequence || 0),
    });
  } else {
    patchNonTurnMessageMetadata(targetMessage, sourceMessage);
    if (existingContent.trim() && !String(sourceMessage?.content || "").trim()) {
      targetMessage.content = existingContent;
    }
    if (existingAttachments.length && !getMessageAttachments(sourceMessage).length) {
      targetMessage.attachments = existingAttachments;
    }
    if (existingModelRuns.length && !hasArrayItems(sourceMessage?.modelRuns)) {
      targetMessage.modelRuns = existingModelRuns;
    }
  }
  const mergedTransferEnvelopes = mergeTransferEnvelopes(
    existingTransferEnvelopes,
    sourceTransferEnvelopes,
  );
  if (mergedTransferEnvelopes.length) {
    targetMessage.transferEnvelopes = mergedTransferEnvelopes;
  }
  if (sourceAssistantWithoutTurnScope) {
    clearTurnScopedAssets(targetMessage);
    delete targetMessage.turnScopeId;
  }
  return targetMessage;
}

export {
  collectReconnectDeltaText,
  findLatestPendingAssistantAfterLastUser,
  findRecoverableReconnectSessionId,
  findReconnectDoneEnvelopeWithMessages,
  findReusableMessageObject,
  getLastUserMessageIndex,
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isDialogProcessRecoverable,
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
  isSessionEntryRunning,
  mergeCurrentUserMessagesIntoFoldedMessages,
  messageCompareKey,
  normalizeMessageContentForCompare,
  parseMessageTimeMs,
  patchMessageObjectPreservingUiState,
  resolveDialogProcessIdFromReplay,
  splitReconnectMessagesByDialogProcessId,
  splitReconnectMessagesByTurnIdentity,
};
