/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyTurnRuntimeEvent,
  applyTurnTerminalResolution,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnTerminalResolution } from "../../../../../../../../shared/turn-lifecycle-protocol.mjs";

export function sendStart(registry, { sessionId, turnScopeId, seq = 1 }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, sessionId, turnScopeId, seq });
}
export function backendState(registry, { sessionId, turnScopeId, dialogProcessId, state, seq }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, state, seq });
}

let terminalResolutionSequence = 0;
export function settleTerminal(registry, {
  sessionId = "s1", turnScopeId = "t1", state = "completed", dialogProcessId = "",
  revision = 100, sequence = 100, completionCommitId = "", summaryVersion = 0,
  failure = null, finalizeIntent = null, materialization = {}, startedAt = "", finishedAt = "",
} = {}) {
  terminalResolutionSequence += 1;
  const resolvedCommitId = completionCommitId || `commit-${turnScopeId}-${revision}`;
  const resolvedSummaryVersion = summaryVersion || revision;
  const terminalFailure = state.endsWith("_failed")
    ? (failure || { phase: state.replace(/_failed$/, ""), message: `${state} terminal failure`, retryable: false })
    : failure;
  return applyTurnTerminalResolution(registry, createTurnTerminalResolution({
    commandId: `terminal-resolution-${terminalResolutionSequence}`,
    sessionId,
    turnScopeId,
    resolved: true,
    turn: {
      turnScopeId,
      dialogProcessId,
      state,
      phase: state.replace(/_failed$/, ""),
      revision,
      sequence,
      completionCommitId: resolvedCommitId,
      summaryVersion: resolvedSummaryVersion,
      failure: terminalFailure,
      finalizeIntent,
      startedAt,
      finishedAt,
      capabilities: { actionLocked: false, canStop: false },
      updatedAt: "2026-01-01T00:00:03.000Z",
    },
    materialization: {
      completionCommitId: resolvedCommitId,
      summaryVersion: resolvedSummaryVersion,
      revision,
      sequence,
      terminalStatus: { status: state },
      messages: [],
      ...materialization,
    },
  }));
}

export function snapshot(overrides = {}) {
  const withMessageIdentity = (turn) => turn ? {
    messageId: `msg-event-${turn.turnScopeId}`,
    presentationMessageId: `msg-${turn.turnScopeId}`,
    ...turn,
  } : null;
  const activeTurn = withMessageIdentity(overrides.activeTurn === undefined ? {
    turnScopeId: "t1", dialogProcessId: "dp1", commandId: "c1", action: "send",
    state: "processing", phase: "processing", executionState: "sending",
    revision: 2, sequence: 2, summaryVersion: 0, failure: null,
    capabilities: { actionLocked: true, canStop: true },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z",
  } : overrides.activeTurn);
  const recentTerminalTurns = (Array.isArray(overrides.recentTerminalTurns)
    ? overrides.recentTerminalTurns
    : []).map(withMessageIdentity);
  return {
    protocolVersion: 2, eventType: "turn.snapshot", commandId: "snapshot-1",
    userId: "u1", sessionId: "s1", sequence: 2,
    activeTurnScopeId: activeTurn?.turnScopeId || "", activeTurn,
    recentTerminalTurns, unchanged: false, generatedAt: "2026-01-01T00:00:02.000Z",
    ...overrides,
    activeTurn,
    recentTerminalTurns,
  };
}
