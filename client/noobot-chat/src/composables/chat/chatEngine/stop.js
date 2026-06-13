/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";

export function forceStopUiFinalize({
  sending,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
} = {}) {
  if (!sending?.value) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.();
  applyConversationState?.(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: String(pendingAssistantMessage?.dialogProcessId || ""),
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
