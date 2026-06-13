/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../shared/constants/chatConstants";

export function normalizeTrimmedString(value) {
  return String(value || "").trim();
}

export function isBlankCompatibleSameId(left, right) {
  const normalizedLeft = normalizeTrimmedString(left);
  const normalizedRight = normalizeTrimmedString(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

export function pickAssistantMessagesForCurrentTurn({ foldedMessages = [], dialogProcessId = "" }) {
  const normalizedDialogProcessId = normalizeTrimmedString(dialogProcessId);
  const messageList = Array.isArray(foldedMessages) ? foldedMessages : [];
  const lastUserMessageIndex = (() => {
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      if (String(messageList[messageIndex]?.role || "") === RoleEnum.USER) {
        return messageIndex;
      }
    }
    return -1;
  })();
  const assistantMessagesAfterLastUser = messageList.filter(
    (messageItem, messageIndex) =>
      messageIndex > lastUserMessageIndex &&
      String(messageItem?.role || "") === RoleEnum.ASSISTANT,
  );
  if (!assistantMessagesAfterLastUser.length) return [];
  if (!normalizedDialogProcessId) return assistantMessagesAfterLastUser;
  const matchedMessages = assistantMessagesAfterLastUser.filter(
    (messageItem) =>
      normalizeTrimmedString(messageItem?.dialogProcessId) === normalizedDialogProcessId,
  );
  return matchedMessages.length ? matchedMessages : assistantMessagesAfterLastUser;
}

export function mergeAssistantContents(assistantMessages = []) {
  const contentList = [];
  for (const assistantMessage of assistantMessages) {
    const content = normalizeTrimmedString(assistantMessage?.content);
    if (!content) continue;
    if (contentList[contentList.length - 1] === content) continue;
    contentList.push(content);
  }
  return contentList.join("\n\n");
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
    normalizeTrimmedString(messageItem?.dialogProcessId),
    normalizeTrimmedString(messageItem?.content),
    semanticPreview,
  ].join("|");
}

export function patchAssistantFromWorkflowMessage(targetMessage = null, workflowMessageItem = {}) {
  if (!targetMessage || !workflowMessageItem) return false;
  const previousPending = Boolean(targetMessage.pending);
  const previousStatusLabel = String(targetMessage.statusLabel || "");
  const previousRealtimeLogs = Array.isArray(targetMessage.realtimeLogs)
    ? targetMessage.realtimeLogs
    : [];
  const previousExecutionLogTotal = Number(targetMessage.executionLogTotal || 0);
  Object.assign(targetMessage, workflowMessageItem);
  targetMessage.pending = previousPending;
  targetMessage.statusLabel = previousStatusLabel;
  targetMessage.realtimeLogs = previousRealtimeLogs;
  targetMessage.executionLogTotal = Math.max(
    previousExecutionLogTotal,
    Number(workflowMessageItem?.executionLogTotal || 0),
    previousRealtimeLogs.length,
  );
  targetMessage.workflowMessage = true;
  return true;
}

export function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = normalizeTrimmedString(logItem?.event);
  const text = normalizeTrimmedString(data?.text);
  return {
    ...data,
    event: normalizeTrimmedString(data?.event || rawEvent || "system") || "system",
    type: normalizeTrimmedString(data?.type || logItem?.type || "system") || "system",
    category: normalizeTrimmedString(data?.category || logItem?.category || "system") || "system",
    dialogProcessId: normalizeTrimmedString(data?.dialogProcessId || logItem?.dialogProcessId),
    ts: normalizeTrimmedString(data?.ts || logItem?.ts) || new Date().toISOString(),
    text: text || (rawEvent ? `[${rawEvent}]` : ""),
  };
}

export function normalizePendingInteractionPayloads(statePayload = {}) {
  const pendingInteractions = Array.isArray(statePayload?.pendingInteractions)
    ? statePayload.pendingInteractions
    : [];
  if (pendingInteractions.length) {
    return pendingInteractions.filter(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
  }
  return statePayload?.pendingInteraction &&
    typeof statePayload.pendingInteraction === "object" &&
    !Array.isArray(statePayload.pendingInteraction)
    ? [statePayload.pendingInteraction]
    : [];
}

export function isInFlightConversationState(state = "") {
  return ["sending", "interaction_pending", "stopping", "reconnecting"].includes(
    normalizeTrimmedString(state),
  );
}

export function isTerminalConversationState(state = "") {
  return ["stopped", "completed", "error", "no_conversation", "expired"].includes(
    normalizeTrimmedString(state),
  );
}

