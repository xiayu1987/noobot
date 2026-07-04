/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";
import {
  SESSION_RUN_EVENT,
  rememberStopRequestedEvent,
} from "../sessionRunStateMachine";
import { isInFlightAssistantMessage } from "./messageStateGuards";
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowMs } from "../../infra/timeFields";
import {
  logResendDebug,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";

function markLatestUserMessageStopped(activeSession, pendingAssistantMessage = null) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const pendingTurnScopeId = getMessageTurnScopeId(pendingAssistantMessage);
  if (!pendingTurnScopeId) return;
  const pendingDialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const targetUserMessageIndex = messages
    .map((messageItem, index) => ({ messageItem, index }))
    .reverse()
    .find(({ messageItem }) => {
      if (getMessageRole(messageItem) !== RoleEnum.USER) return false;
      return getMessageTurnScopeId(messageItem) === pendingTurnScopeId;
    });
  const targetUserMessage = targetUserMessageIndex?.messageItem;
  if (!targetUserMessage) return;
  const markStopped = (messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return;
    if (pendingDialogProcessId && !getMessageDialogProcessId(messageItem)) {
      messageItem.dialogProcessId = pendingDialogProcessId;
    }
    messageItem.stopState = "stopped";
    messageItem.monotonicState = "monotonic";
    messageItem.isMonotonic = true;
    messageItem.monotonic = true;
  };
  markStopped(targetUserMessage);
}

export function forceStopUiFinalize({
  sending,
  canStop,
  applyRunStateEvent,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
} = {}) {
  if (!sending?.value) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.() ||
    [...(activeSession?.value?.messages || [])]
      .reverse()
      .find(
        (messageItem) => isInFlightAssistantMessage(messageItem),
      );
  logResendDebug("stop.forceFinalize", {
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  const fallbackDialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const fallbackTurnScopeId = getMessageTurnScopeId(pendingAssistantMessage);
  const finalizedAtMs = nowMs();
  applyConversationState?.(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      turnScopeId: fallbackTurnScopeId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
    },
    { botMessage: pendingAssistantMessage },
  );
  if (applyRunStateEvent) {
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      turnScopeId: fallbackTurnScopeId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
      source: "force_stop_finalize",
    });
  } else {
    sending.value = false;
    if (canStop) canStop.value = false;
  }
  chatWebSocketClient?.clearLastReceivedSeqMap?.();
  chatWebSocketClient?.dispose?.();
}

function buildStopPayload({ userId, activeSession, pendingAssistantMessage } = {}) {
  const session = activeSession?.value || {};
  const dialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const turnScopeId = getMessageTurnScopeId(pendingAssistantMessage);
  const createdAtMs = nowMs();
  const payload = {
    userId: String(userId?.value ?? userId ?? ""),
    sessionId: String(session.backendSessionId || session.sessionId || session.id || ""),
    dialogProcessId,
    turnScopeId,
    createdAtMs,
    parentSessionId: String(
      session.parentSessionId || pendingAssistantMessage?.parentSessionId || "",
    ),
    parentDialogProcessId: String(
      getMessageParentDialogProcessId(pendingAssistantMessage) || session.parentDialogProcessId || "",
    ),
    partialAssistant: {
      content: String(pendingAssistantMessage?.content || ""),
      dialogProcessId,
      turnScopeId,
        createdAtMs,
      modelAlias: String(pendingAssistantMessage?.modelAlias || ""),
      modelName: String(pendingAssistantMessage?.modelName || ""),
    },
  };
  Object.keys(payload).forEach((key) => {
    if (key !== "partialAssistant" && !normalizeTrimmedString(payload[key])) delete payload[key];
  });
  return payload;
}

export function stopSending({
  sending,
  canStop,
  activeSession,
  userId,
  chatWebSocketClient,
  onForceStopUiFinalize,
  applyRunStateEvent,
} = {}) {
  if (!sending?.value) return false;
  if (canStop && canStop.value === false) return false;
  const pendingAssistantMessage = [...(activeSession?.value?.messages || [])]
    .reverse()
    .find((messageItem) => isInFlightAssistantMessage(messageItem));
  if (!pendingAssistantMessage) return false;
  logResendDebug("stop.request", {
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    sending: sending?.value,
    canStop: canStop?.value,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  const stopPayload = buildStopPayload({ userId, activeSession, pendingAssistantMessage });
  logResendDebug("stop.payload", {
    stopPayload,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
  const stopEvent = rememberStopRequestedEvent({
    sessionId: stopPayload.sessionId,
    dialogProcessId: stopPayload.dialogProcessId,
    turnScopeId: stopPayload.turnScopeId,
    createdAtMs: stopPayload.createdAtMs,
    source: "stop_sending",
  });
  if (applyRunStateEvent) {
    applyRunStateEvent(stopEvent);
  } else if (canStop) {
    canStop.value = false;
  }
  const applyStopRequestFailure = (error) => {
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_FAILURE,
        state: "error",
        sessionId: stopPayload.sessionId,
        dialogProcessId: stopPayload.dialogProcessId,
        turnScopeId: stopPayload.turnScopeId,
        source: "stop_sending_request_failed",
        error,
      });
    } else if (canStop) {
      canStop.value = false;
    }
    return false;
  };
  try {
    const requestResult = chatWebSocketClient?.requestStop?.(
      stopPayload,
      onForceStopUiFinalize,
    );
    if (requestResult && typeof requestResult.catch === "function") {
      return requestResult.catch(applyStopRequestFailure);
    }
    return requestResult;
  } catch (error) {
    return applyStopRequestFailure(error);
  }
}
