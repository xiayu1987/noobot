/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function applySendErrorState({
  error,
  errorEventData,
  activeSession,
  botMessage,
  applyConversationState: _applyConversationState,
  clearPendingInteraction,
  notify,
  translate,
} = {}) {
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
  pendingInteractionRequest,
  interactionSubmitting,
} = {}) {
  if (!pendingInteractionRequest?.value && interactionSubmitting) {
    interactionSubmitting.value = false;
  }
}
