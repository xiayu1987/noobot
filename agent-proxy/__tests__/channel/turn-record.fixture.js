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

export function snapshotTurnRecord(fields) {
  const { turnScopeId, dialogProcessId, state } = fields;
  const failed = state.endsWith("_failed");
  const terminal = isTerminalTurnState(state);
  const timestamp = "2026-08-17T00:00:00.000Z";
  return {
    parentSessionId: "",
    executionId: deriveAgentExecutionId({ turnScopeId }),
    executionKind: "agent",
    rootExecutionId: deriveAgentExecutionId({ turnScopeId }),
    parentExecutionId: "",
    origin: {},
    stage: "",
    commandId: `command-${turnScopeId}`,
    action: "send",
    phase: failed
      ? state.slice(0, -7)
      : TURN_EVENT_PHASE[deriveTurnEventType(state, { action: "send" })],
    executionState: terminal ? (failed ? "error" : "completed") : "sending",
    summaryVersion: 0,
    completionCommitId: "",
    terminalStatus: terminal
      ? createTurnTerminalStatus(failed ? "error" : "completed", {
          turnScopeId,
          dialogProcessId,
          description: failed ? "service restart orphaned turn" : "",
          updatedAt: timestamp,
        })
      : null,
    failure: null,
    finalizeIntent: null,
    continuationSource: null,
    continuedByTurnScopeId: "",
    startedAt: timestamp,
    finishedAt: terminal ? timestamp : "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  };
}
