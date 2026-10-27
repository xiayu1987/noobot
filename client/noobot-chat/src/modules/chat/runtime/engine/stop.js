/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import { isObjectLike } from "@noobot/shared/value";
import { FrontendRunState, SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { nowMs } from "../../model/timeFields.js";
import { AGENT_COMMAND, createTurnStopCommand } from "@noobot/agent-transport-protocol";
import { buildAgentCommandIdentity } from "./commandIdentity.js";
import { logStopDebug } from "../../../debug/loggers/stopDebugLogger.js";
import {
  selectCurrentTurnRuntime,
  selectExecution,
} from "../run-state-machine/turnRuntimeRegistry.js";

function buildStopCommand({ target, executionId }) {
  return createTurnStopCommand({
    identity: buildAgentCommandIdentity(AGENT_COMMAND.STOP, {
      channel: target,
      turn: { turnScopeId: target.turnScopeId },
    }),
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

function requestStop({ target, stopPayload, chatWebSocketClient, applyRunStateEvent }) {
  const identity = {
    sessionId: target.sessionId,
    dialogProcessId: target.dialogProcessId,
    turnScopeId: target.turnScopeId,
  };
  logStopDebug("stop.payload", () => ({
    ...identity,
    commandId: stopPayload.commandId,
    stopPayload,
  }));
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
  const currentSession = activeSession.value;
  if (!isObjectLike(currentSession)) {
    logStopSkipped(null);
    return false;
  }
  const turnRuntime = selectCurrentTurnRuntime(
    turnRuntimeRegistry.value,
    normalizeTrimmedString(currentSession.sessionId),
  );
  if (!isStoppable(turnRuntime, turnRuntime?.canStop === true)) {
    logStopSkipped(turnRuntime);
    return false;
  }
  return requestStop({
    target: turnRuntime,
    stopPayload: buildStopCommand({ target: turnRuntime, executionId: "" }),
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
    target: execution,
    stopPayload: buildStopCommand({ target: execution, executionId: execution.executionId }),
    chatWebSocketClient,
    applyRunStateEvent,
  });
}
