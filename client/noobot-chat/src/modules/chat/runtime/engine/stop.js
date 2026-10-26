/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { FrontendRunState, SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { nowMs } from "../../model/timeFields.js";
import { createTurnStopCommand } from "@noobot/agent-transport-protocol";
import { logStopDebug } from "../../../debug/loggers/stopDebugLogger.js";
import {
  selectCurrentTurnRuntime,
  selectExecution,
} from "../run-state-machine/turnRuntimeRegistry.js";

function buildStopCommand(target, executionId) {
  return createTurnStopCommand({
    identity: {
      sessionId: normalizeTrimmedString(target.sessionId),
      parentSessionId: normalizeTrimmedString(target.parentSessionId),
      dialogProcessId: normalizeTrimmedString(target.dialogProcessId),
      turnScopeId: normalizeTrimmedString(target.turnScopeId),
    },
    concurrency: { expectedTurnRevision: target.revision },
    stop: { executionId },
  });
}

function isStoppable(target, canStop) {
  return Boolean(target) && canStop && target.commandPending !== true && !target.terminal;
}

function logStopSkipped(target) {
  logStopDebug("stop.skip.turnNotStoppable", () => ({
    sessionId: target?.sessionId || "",
    turnScopeId: target?.turnScopeId || "",
    dialogProcessId: target?.dialogProcessId || "",
    state: target?.state || "",
    commandPending: target?.commandPending === true,
    pendingCommandType: target?.pendingCommandType || "",
    terminal: target?.terminal || null,
  }));
}

function requestStop({ stopPayload, chatWebSocketClient, applyRunStateEvent }) {
  logStopDebug("stop.payload", () => ({
    sessionId: stopPayload.identity.sessionId,
    dialogProcessId: stopPayload.identity.dialogProcessId,
    turnScopeId: stopPayload.identity.turnScopeId,
    commandId: stopPayload.commandId,
    stopPayload,
  }));
  const identity = {
    sessionId: stopPayload.identity.sessionId,
    dialogProcessId: stopPayload.identity.dialogProcessId,
    turnScopeId: stopPayload.identity.turnScopeId,
  };
  applyRunStateEvent({
    type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
    state: FrontendRunState.USER_STOPPING,
    ...identity,
    commandId: stopPayload.commandId,
    createdAtMs: nowMs(),
    source: "stop_sending",
  });
  const applyStopRequestFailure = (error) => {
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_RESET,
      ...identity,
      source: "stop_sending_request_failed",
      error,
    });
    return false;
  };
  try {
    const requestResult = chatWebSocketClient.requestStop(stopPayload);
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

export function stopActiveTurn({
  activeSession,
  turnRuntimeRegistry,
  chatWebSocketClient,
  applyRunStateEvent,
}) {
  const turnRuntime = selectCurrentTurnRuntime(
    turnRuntimeRegistry.value,
    normalizeTrimmedString(activeSession.value?.sessionId),
  );
  if (!isStoppable(turnRuntime, turnRuntime?.canStop === true)) {
    logStopSkipped(turnRuntime);
    return false;
  }
  return requestStop({
    stopPayload: buildStopCommand(turnRuntime, ""),
    chatWebSocketClient,
    applyRunStateEvent,
  });
}

export function stopExecution({
  executionId,
  turnRuntimeRegistry,
  chatWebSocketClient,
  applyRunStateEvent,
}) {
  const execution = selectExecution(turnRuntimeRegistry.value, executionId);
  if (!execution?.capabilities.canStop) {
    logStopSkipped(execution);
    return false;
  }
  return requestStop({
    stopPayload: buildStopCommand(execution, execution.executionId),
    chatWebSocketClient,
    applyRunStateEvent,
  });
}
