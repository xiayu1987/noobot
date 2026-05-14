/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";

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
    if (String(messages[messageIndex]?.role || "").trim() === RoleEnum.USER) {
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
    if (String(messageItem?.role || "").trim() !== RoleEnum.ASSISTANT) continue;
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

function messageCompareKey(messageItem = {}) {
  const role = String(messageItem?.role || "").trim();
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const content = normalizeMessageContentForCompare(messageItem?.content || "");
  if (role === RoleEnum.USER) {
    const attachmentKey = (Array.isArray(messageItem?.attachmentMetas)
      ? messageItem.attachmentMetas
      : [])
      .map((attachmentItem) =>
        [attachmentItem?.name, attachmentItem?.attachmentId, attachmentItem?.size]
          .map((item) => String(item || "").trim())
          .join(":"),
      )
      .join(",");
    return `${role}|${content}|${attachmentKey}`;
  }
  return `${role}|${dialogProcessId}|${content}`;
}

function parseMessageTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value > 1e11 ? value : value * 1000;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber > 1e11 ? asNumber : asNumber * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeCurrentUserMessagesIntoFoldedMessages({
  foldedMessages = [],
  existingMessages = [],
} = {}) {
  const outputMessages = Array.isArray(foldedMessages) ? [...foldedMessages] : [];
  const currentMessages = Array.isArray(existingMessages) ? existingMessages : [];
  const existingKeys = new Set(outputMessages.map((messageItem) => messageCompareKey(messageItem)));
  for (const currentMessage of currentMessages) {
    if (String(currentMessage?.role || "").trim() !== RoleEnum.USER) continue;
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
      String(leftMessage?.role || "") === RoleEnum.USER &&
      String(rightMessage?.role || "") === RoleEnum.ASSISTANT
    ) {
      return -1;
    }
    if (
      String(leftMessage?.role || "") === RoleEnum.ASSISTANT &&
      String(rightMessage?.role || "") === RoleEnum.USER
    ) {
      return 1;
    }
    return 0;
  });
  return outputMessages;
}

function findReusableMessageObject(nextMessage = {}, existingMessages = []) {
  const nextRole = String(nextMessage?.role || "").trim();
  const nextDialogProcessId = String(nextMessage?.dialogProcessId || "").trim();
  if (nextRole === RoleEnum.ASSISTANT && nextDialogProcessId) {
    const byDialogProcessId = existingMessages.find(
      (existingMessage) =>
        String(existingMessage?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(existingMessage?.dialogProcessId || "").trim() === nextDialogProcessId,
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

  Object.assign(targetMessage, sourceMessage);

  if (existingContent.trim() && !String(sourceMessage?.content || "").trim()) {
    targetMessage.content = existingContent;
  }
  if (existingAttachmentMetas.length && !Array.isArray(sourceMessage?.attachmentMetas)?.length) {
    targetMessage.attachmentMetas = existingAttachmentMetas;
  }
  if (existingModelRuns.length && !Array.isArray(sourceMessage?.modelRuns)?.length) {
    targetMessage.modelRuns = existingModelRuns;
  }
  if (existingCompletedToolLogs.length && !Array.isArray(sourceMessage?.completedToolLogs)?.length) {
    targetMessage.completedToolLogs = existingCompletedToolLogs;
  }
  if (existingRealtimeLogs.length && !Array.isArray(sourceMessage?.realtimeLogs)?.length) {
    targetMessage.realtimeLogs = existingRealtimeLogs;
  }
  if (thinkingOpenNames) targetMessage.thinkingOpenNames = thinkingOpenNames;
  if (expandedDetailLogKeys) targetMessage.expandedDetailLogKeys = expandedDetailLogKeys;
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
