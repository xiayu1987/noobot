/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../infra/messageIdentity";
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger";
import { BackendChannelState } from "../sessionRunStateMachine";

function normalizeTrimmedString(value = "") {
  return String(value || "").trim();
}

export function applyStreamCompletedFallback({
  finalDoneEventData,
  activeSession,
  botMessage,
  applyConversationState,
} = {}) {
  if (!finalDoneEventData) return false;
  const turnMeta = normalizeTurnMeta(finalDoneEventData);
  applyConversationState(
    {
      state: BackendChannelState.COMPLETED,
      sessionId: String(
        finalDoneEventData?.sessionId ||
          activeSession?.value?.backendSessionId ||
          activeSession?.value?.id ||
          "",
      ),
      dialogProcessId: String(
        getMessageDialogProcessId(botMessage) || finalDoneEventData?.dialogProcessId || "",
      ),
      turnScopeId: String(getMessageTurnScopeId(botMessage) || turnMeta.turnScopeId || ""),
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
  backendStopEventData = null,
} = {}) {
  const stopEvent = backendStopEventData && typeof backendStopEventData === "object"
    ? backendStopEventData
    : null;
  if (!stopEvent) {
    logResendDebug("sendFinalize.stopRequested.skip", { reason: "missingBackendStopConfirmation", botMessage: summarizeDebugMessage(botMessage) });
    return false;
  }
  if (!chatWebSocketClient?.isStopRequested?.()) {
    logResendDebug("sendFinalize.stopRequested.skip", { reason: "notRequested", botMessage: summarizeDebugMessage(botMessage) });
    return false;
  }
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  const stopTurnScopeId = normalizeTrimmedString(stopEvent?.turnScopeId);
  const stopRequestedTurnScopeId = normalizeTrimmedString(
    chatWebSocketClient?.getStopRequestedTurnScopeId?.(),
  );
  const comparableBotTurnScopeId = botTurnScopeId || stopTurnScopeId;
  if (stopRequestedTurnScopeId && comparableBotTurnScopeId && stopRequestedTurnScopeId !== comparableBotTurnScopeId) {
    logResendDebug("sendFinalize.stopRequested.skip", {
      reason: "turnScopeMismatch",
      stopRequestedTurnScopeId,
      botTurnScopeId: comparableBotTurnScopeId,
      botMessage: summarizeDebugMessage(botMessage),
    });
    return false;
  }
  logResendDebug("sendFinalize.stopRequested.hit", {
    stopRequestedTurnScopeId,
    botTurnScopeId: comparableBotTurnScopeId,
    botMessage: summarizeDebugMessage(botMessage),
  });
  applyConversationState(
    {
      state: BackendChannelState.USER_STOPPED,
      sessionId: String(stopEvent?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: String(stopEvent?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
      ...(comparableBotTurnScopeId ? { turnScopeId: String(comparableBotTurnScopeId || "") } : {}),
      sourceEvent: "backend_stopped",
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
      state: BackendChannelState.ERROR,
      sessionId: String(
        errorEventData?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
      ),
      dialogProcessId: String(errorEventData?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
      turnScopeId: String(normalizeTurnMeta(errorEventData).turnScopeId || getMessageTurnScopeId(botMessage) || ""),
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
