/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";
import {
  BackendChannelState,
  FrontendRunState,
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
import { logStopDebug } from "../debug/stopDebugLogger";
import {
  resolveSessionTurnRuntime,
  sessionRuntimeId,
} from "../sessionRunStateMachine/turnRuntimeRegistry";

export function handleStopConfirmationTimeout({
  sending,
  canStop,
  applyRunStateEvent,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
  stopScope = {},
} = {}) {
  if (!sending?.value) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.() ||
    [...(activeSession?.value?.messages || [])]
      .reverse()
      .find(
        (messageItem) => isInFlightAssistantMessage(messageItem, {
          turnStatuses: activeSession?.value?.turnStatuses,
        }),
      );
  const expectedDialogProcessId = normalizeTrimmedString(stopScope?.dialogProcessId);
  const expectedTurnScopeId = normalizeTrimmedString(stopScope?.turnScopeId);
  const pendingDialogProcessIdForScope = getMessageDialogProcessId(pendingAssistantMessage);
  const pendingTurnScopeIdForScope = getMessageTurnScopeId(pendingAssistantMessage);
  const staleStopScope = expectedTurnScopeId
    ? pendingTurnScopeIdForScope !== expectedTurnScopeId
    : expectedDialogProcessId
      ? pendingDialogProcessIdForScope !== expectedDialogProcessId
      : false;
  if (staleStopScope) {
    logStopDebug("stop.timeout.staleIgnored", {
      stopScope,
      pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });
    return;
  }
  logStopDebug("stop.timeout.noBackendConfirmation", {
    stopScope,
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
  const fallbackDialogProcessId =
    expectedDialogProcessId || getMessageDialogProcessId(pendingAssistantMessage);
  const fallbackTurnScopeId =
    expectedTurnScopeId || getMessageTurnScopeId(pendingAssistantMessage);
  const finalizedAtMs = nowMs();
  if (applyRunStateEvent) {
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_FAILURE,
      state: BackendChannelState.ERROR,
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      turnScopeId: fallbackTurnScopeId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
      source: "stop_request_timeout",
      sourceEvent: "stop_request_timeout",
      error: new Error("stop request timed out before backend confirmation"),
    });
  } else {
    // Compatibility fallback for callers that do not provide the run state machine bridge.
    if (canStop) canStop.value = false;
  }
}

function buildStopPayload({ userId, activeSession, pendingAssistantMessage, turnRuntime } = {}) {
  const session = activeSession?.value || {};
  const dialogProcessId = normalizeTrimmedString(turnRuntime?.dialogProcessId);
  const turnScopeId = normalizeTrimmedString(turnRuntime?.turnScopeId);
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
  activeSession,
  turnRuntimeRegistry,
  userId,
  chatWebSocketClient,
  onStopConfirmationTimeout,
  applyRunStateEvent,
} = {}) {
  const sessionId = sessionRuntimeId(activeSession?.value);
  const turnRuntime = resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId);
  if (!turnRuntime?.canStop || turnRuntime?.terminal) {
    logStopDebug("stop.skip.turnNotStoppable", {
      sessionId,
      turnScopeId: turnRuntime?.turnScopeId || "",
      dialogProcessId: turnRuntime?.dialogProcessId || "",
      state: turnRuntime?.state || "",
      terminal: turnRuntime?.terminal || null,
    });
    return false;
  }
  const expectedTurnScopeId = normalizeTrimmedString(turnRuntime.turnScopeId);
  const expectedDialogProcessId = normalizeTrimmedString(turnRuntime.dialogProcessId);
  const pendingAssistantMessage = (activeSession?.value?.messages || []).find((messageItem) => {
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    if (expectedTurnScopeId && messageTurnScopeId === expectedTurnScopeId) return true;
    return !expectedTurnScopeId && expectedDialogProcessId &&
      getMessageDialogProcessId(messageItem) === expectedDialogProcessId;
  });
  logResendDebug("stop.request", {
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    turnRuntime,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
  const stopPayload = buildStopPayload({ userId, activeSession, pendingAssistantMessage, turnRuntime });
  logStopDebug("stop.payload", {
    sessionId: stopPayload.sessionId,
    dialogProcessId: stopPayload.dialogProcessId,
    turnScopeId: stopPayload.turnScopeId,
    stopPayload,
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  });
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
  // The assistant placeholder is the source for composer action rendering.
  // Record the local stopping phase on that same turn before dispatching the
  // request; the global run snapshot is only a transport/lifecycle bridge and
  // must not be required to render "stopping" or guard a duplicate stop.
  if (pendingAssistantMessage) {
    pendingAssistantMessage.pending = true;
    pendingAssistantMessage.channelState = {
      ...(pendingAssistantMessage.channelState && typeof pendingAssistantMessage.channelState === "object"
        ? pendingAssistantMessage.channelState
        : {}),
      state: FrontendRunState.USER_STOPPING,
      sessionId: stopPayload.sessionId,
      dialogProcessId: stopPayload.dialogProcessId,
      turnScopeId: stopPayload.turnScopeId,
      sourceEvent: "stop_sending",
    };
  }
  if (applyRunStateEvent) {
    applyRunStateEvent(stopEvent);
  }
  const applyStopRequestFailure = (error) => {
    // The stop request never reached an active stopping phase. Settle the same
    // placeholder that was marked above so the last-message action immediately
    // falls back to "send" instead of leaving a stale "stopping" projection.
    if (pendingAssistantMessage) {
      pendingAssistantMessage.pending = false;
      pendingAssistantMessage.channelState = {
        ...(pendingAssistantMessage.channelState && typeof pendingAssistantMessage.channelState === "object"
          ? pendingAssistantMessage.channelState
          : {}),
        state: BackendChannelState.ERROR,
        sessionId: stopPayload.sessionId,
        dialogProcessId: stopPayload.dialogProcessId,
        turnScopeId: stopPayload.turnScopeId,
        sourceEvent: "stop_sending_request_failed",
      };
    }
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_FAILURE,
        state: BackendChannelState.ERROR,
        sessionId: stopPayload.sessionId,
        dialogProcessId: stopPayload.dialogProcessId,
        turnScopeId: stopPayload.turnScopeId,
        source: "stop_sending_request_failed",
        error,
      });
    }
    return false;
  };
  try {
    const requestResult = chatWebSocketClient?.requestStop?.(
      stopPayload,
      onStopConfirmationTimeout,
    );
    if (requestResult && typeof requestResult.catch === "function") {
      return requestResult.catch(applyStopRequestFailure);
    }
    return requestResult;
  } catch (error) {
    return applyStopRequestFailure(error);
  }
}
