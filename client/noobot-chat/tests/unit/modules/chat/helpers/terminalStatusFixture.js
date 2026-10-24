/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTurnTerminalStatus } from "@noobot/session-protocol";

const terminalCommandByTurnState = Object.freeze({
  completed: "completed",
  stop_completed: "user_stopped",
  action_failed: "error",
  processing_failed: "error",
  completion_failed: "error",
  stop_failed: "error",
});

export function terminalStatusFixture(state, { turnScopeId, dialogProcessId }) {
  const terminalStatus = createTurnTerminalStatus(terminalCommandByTurnState[state], {
    turnScopeId,
    dialogProcessId,
    description: `fixture ${state}`,
  });
  if (!terminalStatus) throw new Error(`terminal status fixture unsupported: ${state}`);
  return terminalStatus;
}
