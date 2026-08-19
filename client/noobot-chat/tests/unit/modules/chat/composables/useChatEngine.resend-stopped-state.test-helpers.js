/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTurnTerminalResolution } from "@noobot/session-protocol";
import { applyTurnTerminalResolution } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

export function settleStoppedTurn(turnRuntimeRegistry, { sessionId, turnScopeId, messages = [] }) {
  const revision = 100;
  const sequence = 100;
  const completionCommitId = `commit-${turnScopeId}-${revision}`;
  const result = applyTurnTerminalResolution(
    turnRuntimeRegistry.value,
    createTurnTerminalResolution({
      commandId: `resolve-${turnScopeId}-${revision}`,
      sessionId,
      turnScopeId,
      resolved: true,
      aggregateVersion: 1,
      turn: {
        sessionId,
        turnScopeId,
        state: "stop_completed",
        phase: "stop",
        revision,
        sequence,
        completionCommitId,
        summaryVersion: revision,
        capabilities: { actionLocked: false, canStop: false },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      materialization: {
        completionCommitId,
        summaryVersion: revision,
        revision,
        sequence,
        terminalStatus: { status: "stop_completed" },
        messages,
      },
    }),
  );
  if (result?.applied && result.registry) {
    turnRuntimeRegistry.value = { ...result.registry };
  }
  return result;
}
