/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { getMessageClientTurnId, getMessageDialogProcessId, getMessageRole } from "../../infra/messageIdentity";

function normalizeTrimmedString(value = "") {
  return String(value || "").trim();
}

function markLatestUserMessageStopped(activeSession, botMessage = null) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const rawMessages = Array.isArray(activeSession?.value?.rawMessages)
    ? activeSession.value.rawMessages
    : [];
  if (!messages.length) return false;
  const botDialogProcessId = getMessageDialogProcessId(botMessage);
  const botIndex = botMessage ? messages.findIndex((messageItem) => messageItem === botMessage) : -1;
  const startIndex = botIndex >= 0 ? botIndex - 1 : messages.length - 1;
  const markStopped = (messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return;
    const userDialogProcessId = getMessageDialogProcessId(messageItem);
    if (botDialogProcessId && !userDialogProcessId) {
      messageItem.dialogProcessId = botDialogProcessId;
    }
    messageItem.stopState = "stopped";
    messageItem.monotonicState = "monotonic";
    messageItem.isMonotonic = true;
    messageItem.monotonic = true;
  };
  for (let index = startIndex; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (getMessageRole(messageItem) !== RoleEnum.USER) continue;
    const userDialogProcessId = getMessageDialogProcessId(messageItem);
    if (botDialogProcessId && userDialogProcessId && userDialogProcessId !== botDialogProcessId) {
      return false;
    }
    markStopped(messageItem);
    const rawCandidate = rawMessages[index];
    if (rawCandidate && getMessageRole(rawCandidate) === RoleEnum.USER) {
      markStopped(rawCandidate);
      return true;
    }
    const userContent = normalizeTrimmedString(messageItem?.content);
    for (let rawIndex = rawMessages.length - 1; rawIndex >= 0; rawIndex -= 1) {
      const rawMessage = rawMessages[rawIndex];
      if (getMessageRole(rawMessage) !== RoleEnum.USER) continue;
      const rawDialogProcessId = getMessageDialogProcessId(rawMessage);
      if (botDialogProcessId && rawDialogProcessId && rawDialogProcessId !== botDialogProcessId) continue;
      if (!botDialogProcessId && userContent && normalizeTrimmedString(rawMessage?.content) !== userContent) continue;
      markStopped(rawMessage);
      return true;
    }
    return true;
  }
  return false;
}

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
        getMessageDialogProcessId(botMessage) || finalDoneEventData?.dialogProcessId || "",
      ),
      clientTurnId: String(getMessageClientTurnId(botMessage) || finalDoneEventData?.clientTurnId || finalDoneEventData?.turnScopeId || finalDoneEventData?.client_turn_id || ""),
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
  markLatestUserMessageStopped(activeSession, botMessage);
  applyConversationState(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: String(getMessageDialogProcessId(botMessage) || ""),
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
      dialogProcessId: String(errorEventData?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
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
