/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  deriveAgentExecutionId,
  isTerminalTurnState,
  TURN_EVENT_PHASE,
  deriveTurnEventType,
} from "@noobot/session-protocol";
import { terminalStatusFixture } from "./terminalStatusFixture.js";

export function turnRecordFixture(fields = {}) {
  const {
    turnScopeId = "t1",
    dialogProcessId = "dp1",
    state = "processing",
    action = "send",
  } = fields;
  const failed = state.endsWith("_failed");
  const phase = failed
    ? state.slice(0, -"_failed".length)
    : TURN_EVENT_PHASE[deriveTurnEventType(state, { action })];
  const terminal = isTerminalTurnState(state);
  const timestamp = "2026-01-01T00:00:00.000Z";
  const finalizing = state === "completion_requesting" || state === "stopping";
  return {
    turnScopeId,
    dialogProcessId,
    state,
    action,
    phase,
    sessionId: "s1",
    presentationMessageId: `msg-${turnScopeId}`,
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
      ? terminalStatusFixture(state, { turnScopeId, dialogProcessId })
      : null,
    failure: failed
      ? { code: "fixture_failure", message: "fixture failure", retryable: false }
      : null,
    finalizeIntent: finalizing
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
    finishedAt: terminal ? "2026-01-01T00:00:03.000Z" : "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  };
}
