/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function applyStreamCompletedFallback({
  sending,
  finalDoneEventData,
  activeSession,
  botMessage,
  applyConversationState,
} = {}) {
  if (!sending?.value || !finalDoneEventData) return false;
  applyConversationState(
    {
      state: "completed",
      sessionId: String(
        finalDoneEventData?.sessionId ||
          activeSession?.value?.backendSessionId ||
          activeSession?.value?.id ||
          "",
      ),
      dialogProcessId: String(
        botMessage?.dialogProcessId || finalDoneEventData?.dialogProcessId || "",
      ),
      sourceEvent: "stream_finalize_fallback",
    },
    { botMessage },
  );
  return true;
}

export function applyStopRequestedState({
  chatWebSocketClient,
  activeSession,
  botMessage,
  applyConversationState,
} = {}) {
  if (!chatWebSocketClient?.isStopRequested?.()) return false;
  applyConversationState(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: String(botMessage?.dialogProcessId || ""),
    },
    { botMessage },
  );
  return true;
}

export function applySendErrorState({
  error,
  errorEventData,
  activeSession,
  botMessage,
  applyConversationState,
  clearPendingInteraction,
  notify,
  translate,
} = {}) {
  applyConversationState(
    {
      state: "error",
      sessionId: String(
        errorEventData?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
      ),
      dialogProcessId: String(errorEventData?.dialogProcessId || botMessage?.dialogProcessId || ""),
      sourceEvent: errorEventData ? "stream_error" : undefined,
    },
    { botMessage },
  );
  clearPendingInteraction?.();
  const errorMessage = error?.message || translate("chat.unknownError");
  botMessage.error = errorMessage;
  if (!botMessage.content?.trim()) {
    botMessage.content = `> ${translate("chat.occurredError", { error: botMessage.error })}`;
  } else {
    botMessage.content += `\n\n> ${translate("chat.occurredError", { error: botMessage.error })}`;
  }
  notify?.({ type: "error", message: error?.message || translate("chat.sendFailed") });
}

export function finalizeSendCleanup({
  chatWebSocketClient,
  pendingInteractionRequest,
  interactionSubmitting,
} = {}) {
  chatWebSocketClient?.clearStopRequested?.();
  if (!pendingInteractionRequest?.value && interactionSubmitting) {
    interactionSubmitting.value = false;
  }
}
