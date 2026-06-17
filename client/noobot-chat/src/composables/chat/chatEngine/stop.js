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
  const pendingDialogProcessId = normalizeTrimmedString(pendingAssistantMessage?.dialogProcessId);
  const latestUserMessage = [...messages]
    .reverse()
    .find((messageItem) => {
      if (normalizeTrimmedString(messageItem?.role) !== RoleEnum.USER) return false;
      if (!pendingDialogProcessId) return true;
      const userDialogProcessId = normalizeTrimmedString(
        messageItem?.dialogProcessId || messageItem?.dialogId,
      );
      return !userDialogProcessId || userDialogProcessId === pendingDialogProcessId;
    });
  if (!latestUserMessage) return;
  if (pendingDialogProcessId && !normalizeTrimmedString(latestUserMessage?.dialogProcessId || latestUserMessage?.dialogId)) {
    latestUserMessage.dialogProcessId = pendingDialogProcessId;
  }
  latestUserMessage.stopState = "stopped";
  latestUserMessage.monotonicState = "monotonic";
  latestUserMessage.isMonotonic = true;
  latestUserMessage.monotonic = true;
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
