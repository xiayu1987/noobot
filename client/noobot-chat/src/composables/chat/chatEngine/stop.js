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
  selectExecution,
  sessionRuntimeId,
} from "../sessionRunStateMachine/turnRuntimeRegistry";

function resolveStopTurnScopeId({ session, turnRuntimeRegistry, preferredTurnScopeId = "" } = {}) {
  const preferred = normalizeTrimmedString(preferredTurnScopeId);
  if (preferred) return preferred;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const scope = normalizeTrimmedString(getMessageTurnScopeId(messages[index]));
    if (scope) return scope;
  }
  const sessionId = sessionRuntimeId(session);
  const registry = turnRuntimeRegistry?.value || turnRuntimeRegistry;
  const canonicalSessionId = normalizeTrimmedString(registry?.sessionAliases?.[sessionId] || sessionId);
  return normalizeTrimmedString(registry?.sessions?.[canonicalSessionId]?.activeTurnScopeId);
}

function resolveStopTarget({ activeSession, turnRuntimeRegistry, executionId = "" } = {}) {
  const requestedExecutionId = normalizeTrimmedString(executionId);
  if (requestedExecutionId) {
    const execution = selectExecution(turnRuntimeRegistry?.value, requestedExecutionId);
    if (!execution) return { execution: null, turnRuntime: null, session: null };
    const sessionId = normalizeTrimmedString(execution.sessionId);
    const active = activeSession?.value || null;
    const session = sessionRuntimeId(active) === sessionId
      ? active
      : {
          backendSessionId: sessionId,
          sessionId,
          id: sessionId,
          parentSessionId: execution.parentSessionId || "",
          parentDialogProcessId: execution.parentDialogProcessId || "",
          messages: [],
        };
    return { execution, turnRuntime: execution, session };
  }
  const session = activeSession?.value || null;
  const sessionId = sessionRuntimeId(session);
  const turnScopeId = resolveStopTurnScopeId({ session, turnRuntimeRegistry });
  return {
    execution: null,
    turnRuntime: resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId),
    session,
  };
}

export function handleStopConfirmationTimeout({
  turnRuntimeRegistry,
  applyRunStateEvent,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
  stopScope = {},
} = {}) {
  const timeoutSessionId = sessionRuntimeId(activeSession?.value);
  const timeoutTurnScopeId = resolveStopTurnScopeId({
    session: activeSession?.value,
    turnRuntimeRegistry,
    preferredTurnScopeId: stopScope?.turnScopeId,
  });
  const timeoutTurn = resolveSessionTurnRuntime(
    turnRuntimeRegistry?.value,
    timeoutSessionId,
    timeoutTurnScopeId,
  );
  if (!timeoutTurn || timeoutTurn.terminal) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.() ||
    [...(activeSession?.value?.messages || [])]
      .reverse()
      .find(
        (messageItem) => isInFlightAssistantMessage(messageItem, {
          registry: turnRuntimeRegistry?.value,
          sessionId: timeoutSessionId,
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
  applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_RESET,
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      turnScopeId: fallbackTurnScopeId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
      source: "stop_request_timeout",
      sourceEvent: "stop_request_timeout",
      reason: "stop request timed out before backend confirmation",
  });
}

function buildStopPayload({ userId, activeSession, session: targetSession, pendingAssistantMessage, turnRuntime, execution } = {}) {
  const session = targetSession || activeSession?.value || {};
  const dialogProcessId = normalizeTrimmedString(turnRuntime?.dialogProcessId);
  const turnScopeId = normalizeTrimmedString(turnRuntime?.turnScopeId);
  const createdAtMs = nowMs();
  const payload = {
    userId: String(userId?.value ?? userId ?? ""),
    sessionId: String(session.backendSessionId || session.sessionId || session.id || ""),
    dialogProcessId,
    turnScopeId,
    executionId: normalizeTrimmedString(execution?.executionId),
    expectedRevision: Number.isFinite(Number(execution?.revision))
      ? Number(execution.revision)
      : undefined,
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
  executionId = "",
} = {}) {
  const target = resolveStopTarget({ activeSession, turnRuntimeRegistry, executionId });
  const { execution, turnRuntime, session } = target;
  const sessionId = normalizeTrimmedString(turnRuntime?.sessionId) || sessionRuntimeId(session);
  const canStop = execution
    ? execution?.capabilities?.canStop === true || execution?.canStop === true
    : turnRuntime?.canStop === true;
  if (!turnRuntime || !canStop || turnRuntime?.terminal) {
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
  const pendingAssistantMessage = (session?.messages || []).find((messageItem) => {
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
  const stopPayload = buildStopPayload({
    userId,
    activeSession,
    session,
    pendingAssistantMessage,
    turnRuntime,
    execution,
  });
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
  if (applyRunStateEvent) {
    applyRunStateEvent(stopEvent);
  }
  const applyStopRequestFailure = (error) => {
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_RESET,
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
