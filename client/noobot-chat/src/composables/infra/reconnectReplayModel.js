/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
import {
  getMessageTransferAttachmentMetas,
  getMessageTransferEnvelopes,
  normalizeTransferEnvelopes,
} from "./transferEnvelopes";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  hasMessageTurnScopeConflict,
} from "./messageIdentity";
import {
  getThinkingFinishedAt,
  getThinkingStartedAt,
  parseTimeMs,
  setThinkingFinishedAt,
  setThinkingStartedAt,
} from "./timeFields";

function isReconnectTerminalEvent(eventName = "") {
  return [
    StreamEventEnum.DONE,
    StreamEventEnum.STOPPED,
    StreamEventEnum.ERROR,
  ].includes(String(eventName || "").trim());
}

function isPendingInteractionReplay(envelope = {}) {
  return (
    String(envelope?.event || "").trim() === StreamEventEnum.INTERACTION_REQUEST &&
    envelope?.data?.__agentProxyPendingInteraction === true
  );
}

function isSessionEntryRunning(sessionEntry = {}) {
  return sessionEntry?.hasRunningTask === true;
}

function hasPendingInteractionReplayEvents(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((envelope) =>
    isPendingInteractionReplay(envelope),
  );
}

function isDialogProcessRecoverable(sessionEntry = {}, messages = []) {
  if (isSessionEntryRunning(sessionEntry)) return true;
  // agent-proxy owns replay/running state. Cached replay can contain thinking
  // or delta events from a finished run; those must not imply pending UI.
  return hasPendingInteractionReplayEvents(messages);
}

function findRecoverableReconnectSessionId(sessionsPayload = []) {
  for (const sessionEntry of Array.isArray(sessionsPayload) ? sessionsPayload : []) {
    const sessionId = String(sessionEntry?.sessionId || "").trim();
    if (!sessionId) continue;
    if (isSessionEntryRunning(sessionEntry)) return sessionId;
    const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
      ? sessionEntry.dialogProcesses
      : [];
    const hasPendingInteraction = dialogProcesses.some((dialogProcess) =>
      hasPendingInteractionReplayEvents(dialogProcess?.messages || []),
    );
    if (hasPendingInteraction) return sessionId;
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

function splitReconnectMessagesByDialogProcessId(
  messages = [],
  fallbackDialogProcessId = "",
) {
  const normalizedFallback = String(fallbackDialogProcessId || "").trim();
  const groups = new Map();
  for (const envelope of Array.isArray(messages) ? messages : []) {
    const envelopeDpId = String(envelope?.data?.dialogProcessId || "").trim();
    const groupKey = envelopeDpId || normalizedFallback || "__unknown__";
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(envelope);
  }
  return Array.from(groups.entries()).map(([groupKey, groupMessages]) => ({
    dialogProcessId: groupKey === "__unknown__" ? "" : groupKey,
    messages: groupMessages,
  }));
}

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

const EXECUTION_LOG_DISPLAY_LIMIT = 10;
const IN_FLIGHT_CHANNEL_STATES = new Set([
  "sending",
  "reconnecting",
  "interaction_pending",
  "stopping",
]);

function hasArrayItems(value = null) {
  return Array.isArray(value) && value.length > 0;
}

function buildTransferEnvelopeKey(envelope = {}) {
  const fileKeys = getArrayItems(envelope?.files)
    .map((file) =>
      [
        file?.filePath,
        file?.pathView?.displayPath,
        file?.pathView?.sandboxPath,
        file?.pathView?.relativePath,
        file?.attachmentMeta?.attachmentId,
        file?.attachmentMeta?.relativePath,
        file?.attachmentMeta?.name,
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join("|"),
    )
    .filter(Boolean)
    .join(",");
  return [
    envelope?.protocol,
    envelope?.version,
    envelope?.direction,
    envelope?.transport,
    envelope?.filePath,
    envelope?.attachmentMeta?.attachmentId,
    envelope?.attachmentMeta?.relativePath,
    fileKeys,
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
    const attachmentKey = [
      ...getArrayItems(messageItem?.attachmentMetas),
      ...getMessageTransferAttachmentMetas(messageItem),
    ]
      .map((attachmentItem) =>
        [
          attachmentItem?.name,
          attachmentItem?.attachmentId,
          attachmentItem?.size,
          attachmentItem?.transferFilePath,
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
  const nextTurnScopeId = getMessageTurnScopeId(nextMessage);
  if (nextRole === RoleEnum.ASSISTANT && nextTurnScopeId) {
    const byTurnScopeId = existingMessages.find(
      (existingMessage) =>
        getMessageRole(existingMessage) === RoleEnum.ASSISTANT &&
        getMessageTurnScopeId(existingMessage) === nextTurnScopeId,
    );
    if (byTurnScopeId) return byTurnScopeId;
  }

  const nextDialogProcessId = getMessageDialogProcessId(nextMessage);
  if (nextRole === RoleEnum.ASSISTANT && nextDialogProcessId) {
    const byDialogProcessId = existingMessages.find(
      (existingMessage) =>
        getMessageRole(existingMessage) === RoleEnum.ASSISTANT &&
        getMessageDialogProcessId(existingMessage) === nextDialogProcessId &&
        !hasMessageTurnScopeConflict(existingMessage, nextMessage),
    );
    if (byDialogProcessId) return byDialogProcessId;
  }
  const nextKey = messageCompareKey(nextMessage);
  return (
    existingMessages.find((existingMessage) => messageCompareKey(existingMessage) === nextKey) ||
    null
  );
}

function patchMessageObjectPreservingUiState(targetMessage = {}, sourceMessage = {}) {
  const thinkingOpenNames = Array.isArray(targetMessage?.thinkingOpenNames)
    ? targetMessage.thinkingOpenNames
    : null;
  const expandedDetailLogKeys = Array.isArray(targetMessage?.expandedDetailLogKeys)
    ? targetMessage.expandedDetailLogKeys
    : null;
  const existingContent = String(targetMessage?.content || "");
  const existingAttachmentMetas = Array.isArray(targetMessage?.attachmentMetas)
    ? targetMessage.attachmentMetas
    : [];
  const existingModelRuns = Array.isArray(targetMessage?.modelRuns)
    ? targetMessage.modelRuns
    : [];
  const existingCompletedToolLogs = Array.isArray(targetMessage?.completedToolLogs)
    ? targetMessage.completedToolLogs
    : [];
  const existingRealtimeLogs = Array.isArray(targetMessage?.realtimeLogs)
    ? targetMessage.realtimeLogs
    : [];
  const existingChannelState =
    targetMessage?.channelState &&
    typeof targetMessage.channelState === "object" &&
    !Array.isArray(targetMessage.channelState)
      ? targetMessage.channelState
      : null;
  const existingThinkingStartedAt = getThinkingStartedAt(targetMessage);
  const existingThinkingFinishedAt = getThinkingFinishedAt(targetMessage);
  const existingTurnScopeId = getMessageTurnScopeId(targetMessage);
  const existingPending = targetMessage?.pending === true;
  const existingTransferResult =
    targetMessage?.transferResult &&
    typeof targetMessage.transferResult === "object" &&
    !Array.isArray(targetMessage.transferResult)
      ? targetMessage.transferResult
      : null;
  const sourceTransferResult =
    sourceMessage?.transferResult &&
    typeof sourceMessage.transferResult === "object" &&
    !Array.isArray(sourceMessage.transferResult)
      ? sourceMessage.transferResult
      : null;
  const existingTransferEnvelopes = getMessageTransferEnvelopes(targetMessage);
  const sourceTransferEnvelopes = getMessageTransferEnvelopes(sourceMessage);

  Object.assign(targetMessage, sourceMessage);

  if (existingContent.trim() && !String(sourceMessage?.content || "").trim()) {
    targetMessage.content = existingContent;
  }
  if (existingAttachmentMetas.length && !hasArrayItems(sourceMessage?.attachmentMetas)) {
    targetMessage.attachmentMetas = existingAttachmentMetas;
  }
  if (existingModelRuns.length && !hasArrayItems(sourceMessage?.modelRuns)) {
    targetMessage.modelRuns = existingModelRuns;
  }
  if (existingCompletedToolLogs.length && !hasArrayItems(sourceMessage?.completedToolLogs)) {
    targetMessage.completedToolLogs = existingCompletedToolLogs;
  }
  if (hasArrayItems(sourceMessage?.realtimeLogs)) {
    targetMessage.realtimeLogs = sourceMessage.realtimeLogs.slice(-EXECUTION_LOG_DISPLAY_LIMIT);
  } else if (existingRealtimeLogs.length) {
    targetMessage.realtimeLogs = existingRealtimeLogs.slice(-EXECUTION_LOG_DISPLAY_LIMIT);
  }
  if (!sourceTransferResult && existingTransferResult) {
    targetMessage.transferResult = existingTransferResult;
  }
  const mergedTransferEnvelopes = mergeTransferEnvelopes(
    existingTransferEnvelopes,
    sourceTransferEnvelopes,
  );
  if (mergedTransferEnvelopes.length) {
    targetMessage.transferEnvelopes = mergedTransferEnvelopes;
  }
  if (thinkingOpenNames) targetMessage.thinkingOpenNames = thinkingOpenNames;
  if (expandedDetailLogKeys) targetMessage.expandedDetailLogKeys = expandedDetailLogKeys;
  if (existingChannelState && !sourceMessage?.channelState) {
    targetMessage.channelState = existingChannelState;
  }
  if (existingThinkingStartedAt && !getThinkingStartedAt(sourceMessage)) {
    setThinkingStartedAt(targetMessage, existingThinkingStartedAt);
  }
  if (existingThinkingFinishedAt && !getThinkingFinishedAt(sourceMessage)) {
    setThinkingFinishedAt(targetMessage, existingThinkingFinishedAt);
  }
  if (existingTurnScopeId && !getMessageTurnScopeId(sourceMessage)) {
    targetMessage.turnScopeId = existingTurnScopeId;
  }
  const channelState = String(targetMessage?.channelState?.state || "").trim();
  if (existingPending && IN_FLIGHT_CHANNEL_STATES.has(channelState)) {
    targetMessage.pending = true;
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
  hasPendingInteractionReplayEvents,
  isDialogProcessRecoverable,
  isPendingInteractionReplay,
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
};
