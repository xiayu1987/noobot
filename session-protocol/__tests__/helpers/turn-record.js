/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function turnRecord(overrides = {}) {
  const { turnScopeId = "turn-1" } = overrides;
  return {
    turnScopeId,
    presentationMessageId: "message-1",
    dialogProcessId: "dialog-1",
    executionId: `agent:${turnScopeId}`,
    executionKind: "agent",
    rootExecutionId: `agent:${turnScopeId}`,
    parentExecutionId: "",
    origin: {},
    stage: "",
    commandId: "command-1",
    action: "send",
    state: "processing",
    phase: "processing",
    executionState: "sending",
    revision: 1,
    sequence: 1,
    summaryVersion: 0,
    completionCommitId: "",
    terminalStatus: null,
    failure: null,
    finalizeIntent: null,
    continuationSource: null,
    continuedByTurnScopeId: "",
    startedAt: "2026-07-30T00:00:00.000Z",
    finishedAt: "",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}
