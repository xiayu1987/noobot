/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";

function markLatestUserMessageStopped(activeSession, pendingAssistantMessage = null) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const rawMessages = Array.isArray(activeSession?.value?.rawMessages)
    ? activeSession.value.rawMessages
    : [];
  const pendingDialogProcessId = normalizeTrimmedString(pendingAssistantMessage?.dialogProcessId);
  const latestUserMessageIndex = messages
    .map((messageItem, index) => ({ messageItem, index }))
    .reverse()
    .find(({ messageItem }) => {
      if (normalizeTrimmedString(messageItem?.role) !== RoleEnum.USER) return false;
      if (!pendingDialogProcessId) return true;
      const userDialogProcessId = normalizeTrimmedString(
        messageItem?.dialogProcessId || messageItem?.dialogId,
      );
      return !userDialogProcessId || userDialogProcessId === pendingDialogProcessId;
    });
  const latestUserMessage = latestUserMessageIndex?.messageItem;
  if (!latestUserMessage) return;
  const markStopped = (messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return;
    if (pendingDialogProcessId && !normalizeTrimmedString(messageItem?.dialogProcessId || messageItem?.dialogId)) {
      messageItem.dialogProcessId = pendingDialogProcessId;
    }
    messageItem.stopState = "stopped";
    messageItem.monotonicState = "monotonic";
    messageItem.isMonotonic = true;
    messageItem.monotonic = true;
  };
  markStopped(latestUserMessage);
  const rawCandidate = rawMessages[latestUserMessageIndex.index];
  if (rawCandidate && normalizeTrimmedString(rawCandidate?.role) === RoleEnum.USER) {
    markStopped(rawCandidate);
    return;
  }
  const latestUserContent = normalizeTrimmedString(latestUserMessage?.content);
  for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
    const rawMessage = rawMessages[index];
    if (normalizeTrimmedString(rawMessage?.role) !== RoleEnum.USER) continue;
    const rawDialogProcessId = normalizeTrimmedString(rawMessage?.dialogProcessId || rawMessage?.dialogId);
    if (pendingDialogProcessId && rawDialogProcessId && rawDialogProcessId !== pendingDialogProcessId) continue;
    if (!pendingDialogProcessId && latestUserContent && normalizeTrimmedString(rawMessage?.content) !== latestUserContent) continue;
    markStopped(rawMessage);
    return;
  }
}

export function forceStopUiFinalize({
  sending,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
} = {}) {
  if (!sending?.value) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.();
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  const fallbackDialogProcessId = normalizeTrimmedString(
    pendingAssistantMessage?.dialogProcessId,
  );
  applyConversationState?.(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
    },
    { botMessage: pendingAssistantMessage },
  );
  sending.value = false;
  chatWebSocketClient?.clearLastReceivedSeqMap?.();
  chatWebSocketClient?.dispose?.();
}

export function stopSending({
  sending,
  activeSession,
  chatWebSocketClient,
  onForceStopUiFinalize,
} = {}) {
  if (!sending?.value) return false;
  const pendingAssistantMessage = [...(activeSession?.value?.messages || [])]
    .reverse()
    .find(
      (messageItem) =>
        normalizeTrimmedString(messageItem?.role) === RoleEnum.ASSISTANT &&
        Boolean(messageItem?.pending),
    );
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  return chatWebSocketClient?.requestStop?.(
    {
      partialAssistant: {
        content: String(pendingAssistantMessage?.content || ""),
        dialogProcessId: String(pendingAssistantMessage?.dialogProcessId || ""),
        modelAlias: String(pendingAssistantMessage?.modelAlias || ""),
        modelName: String(pendingAssistantMessage?.modelName || ""),
      },
    },
    onForceStopUiFinalize,
  );
}
