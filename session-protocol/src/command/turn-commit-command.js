/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { createCommandRequestHash } from "./command-fingerprint.js";
import { requireTurnCommitAction } from "../lifecycle/turn-commit-action.js";

export function createTurnCommitFingerprint({
  action,
  content = "",
  turnScopeId = "",
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
} = {}) {
  return createCommandRequestHash({
    type: "session.turn.commit",
    action: requireTurnCommitAction(action),
    content: clean(content),
    turnScopeId: clean(turnScopeId),
    resumeDialogProcessId: clean(resumeDialogProcessId),
    resumeTurnScopeId: clean(resumeTurnScopeId),
  });
}
