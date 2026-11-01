/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnTerminalStatus,
  deriveAgentExecutionId,
  deriveTurnEventType,
  isTerminalTurnState,
  TURN_EVENT_PHASE,
} from "@noobot/session-protocol";

export function turnRecord(fields = {}) {
  const {
    turnScopeId = "turn-1",
    dialogProcessId = "dialog-1",
    state = "processing",
    action = "send",
  } = fields;
  const failed = state.endsWith("_failed");
  const phase = failed
    ? state.slice(0, -7)
    : TURN_EVENT_PHASE[deriveTurnEventType(state, { action })];
  const terminal = isTerminalTurnState(state);
  const timestamp = "2026-07-30T00:00:00.000Z";
  return {
    turnScopeId,
    dialogProcessId,
    state,
    action,
    phase,
    presentationMessageId: `message-${turnScopeId}`,
    commandId: `command-${turnScopeId}`,
    executionId: deriveAgentExecutionId({ turnScopeId }),
    executionKind: "agent",
    rootExecutionId: deriveAgentExecutionId({ turnScopeId }),
    parentExecutionId: "",
    origin: {},
    stage: "",
    executionState: terminal
      ? failed
        ? "error"
        : state === "stop_completed"
          ? "user_stopped"
          : "completed"
      : "sending",
    revision: 1,
    sequence: 1,
    summaryVersion: 0,
    completionCommitId: "",
    terminalStatus: terminal
      ? createTurnTerminalStatus(
          failed ? "error" : state === "stop_completed" ? "user_stopped" : "completed",
          {
            turnScopeId,
            dialogProcessId,
            description: failed ? "fixture failure" : "",
            updatedAt: timestamp,
          },
        )
      : null,
    failure: failed
      ? { code: "fixture_failure", message: "fixture failure", retryable: false }
      : null,
    finalizeIntent: ["completion_requesting", "stopping"].includes(state)
      ? {
          type: phase === "stop" ? "stop" : "completion",
          commandId: "finalize-1",
          retryable: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : null,
    continuationSource: null,
    continuedByTurnScopeId: "",
    startedAt: timestamp,
    finishedAt: terminal ? timestamp : "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  };
}
