/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../infra/messageIdentity.js";
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger.js";
import { BackendChannelState, FrontendRunState } from "../sessionRunStateMachine.js";
import { resolveSessionTurnRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry.js";

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

export function applyBackendStoppedState({
  activeSession,
  turnRuntimeRegistry,
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
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  const stopTurnScopeId = normalizeTrimmedString(stopEvent?.turnScopeId);
  const comparableBotTurnScopeId = botTurnScopeId || stopTurnScopeId;
  if (botTurnScopeId && stopTurnScopeId && botTurnScopeId !== stopTurnScopeId) {
    logResendDebug("sendFinalize.stopRequested.skip", {
      reason: "turnScopeMismatch",
      stopTurnScopeId,
      botTurnScopeId: comparableBotTurnScopeId,
      botMessage: summarizeDebugMessage(botMessage),
    });
    return false;
  }
  const sessionId = String(
    stopEvent?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
  );
  const turnRuntime = resolveSessionTurnRuntime(
    turnRuntimeRegistry?.value || turnRuntimeRegistry,
    sessionId,
    comparableBotTurnScopeId,
  );
  const runtimeConfirmsStop = !turnRuntime || turnRuntime.action === "stop" ||
    turnRuntime.state === FrontendRunState.USER_STOPPING || turnRuntime.terminal === "user_stopped";
  if (!runtimeConfirmsStop) {
    logResendDebug("sendFinalize.stopRequested.skip", {
      reason: "registryDoesNotConfirmStop",
      turnScopeId: comparableBotTurnScopeId,
      botMessage: summarizeDebugMessage(botMessage),
    });
    return false;
  }
  logResendDebug("sendFinalize.stopRequested.hit", {
    botTurnScopeId: comparableBotTurnScopeId,
    botMessage: summarizeDebugMessage(botMessage),
  });
  applyConversationState(
    {
      state: BackendChannelState.USER_STOPPED,
      sessionId,
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
  pendingInteractionRequest,
  interactionSubmitting,
} = {}) {
  if (!pendingInteractionRequest?.value && interactionSubmitting) {
    interactionSubmitting.value = false;
  }
}
