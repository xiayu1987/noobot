/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../model/chatConstants.js";
import { normalizeTrimmedString } from "./utils.js";
import {
  SESSION_RUN_EVENT,
  rememberStopRequestedEvent,
} from "../sessionRunStateMachine.js";
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { nowMs } from "../../model/timeFields.js";
import {
  logResendDebug,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import { logStopDebug } from "../../../debug/loggers/stopDebugLogger.js";
import {
  resolveSessionTurnRuntime,
  selectExecution,
  sessionRuntimeId,
} from "../run-state-machine/turnRuntimeRegistry.js";

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
    commandId: `stop:${turnScopeId}`,
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
    logStopDebug("stop.skip.turnNotStoppable", () => ({
      sessionId,
      turnScopeId: turnRuntime?.turnScopeId || "",
      dialogProcessId: turnRuntime?.dialogProcessId || "",
      state: turnRuntime?.state || "",
      terminal: turnRuntime?.terminal || null,
    }));
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
  logResendDebug("stop.request", () => ({
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    turnRuntime,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  const stopPayload = buildStopPayload({
    userId,
    activeSession,
    session,
    pendingAssistantMessage,
    turnRuntime,
    execution,
  });
  logStopDebug("stop.payload", () => ({
    sessionId: stopPayload.sessionId,
    dialogProcessId: stopPayload.dialogProcessId,
    turnScopeId: stopPayload.turnScopeId,
    commandId: stopPayload.commandId,
    stopPayload,
    pendingAssistant: summarizeDebugMessage(pendingAssistantMessage),
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  logResendDebug("stop.payload", () => ({
    stopPayload,
    messages: summarizeDebugMessages(activeSession?.value?.messages),
  }));
  const stopEvent = rememberStopRequestedEvent({
    sessionId: stopPayload.sessionId,
    dialogProcessId: stopPayload.dialogProcessId,
    turnScopeId: stopPayload.turnScopeId,
    commandId: stopPayload.commandId,
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
    const requestResult = chatWebSocketClient?.requestStop?.(stopPayload);
    if (requestResult && typeof requestResult.catch === "function") {
      return requestResult.catch(applyStopRequestFailure);
    }
    return requestResult === true
      ? true
      : applyStopRequestFailure(new Error("stop_request_not_sent"));
  } catch (error) {
    return applyStopRequestFailure(error);
  }
}
