/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCommandRequestHash } from "./command-fingerprint.js";
import { TURN_COMMIT_ACTION, normalizeTurnCommitAction } from "../lifecycle/turn-commit-action.js";
import { text as clean } from "../normalize.js";

export function createTurnCommitFingerprint({
  action = TURN_COMMIT_ACTION.SEND,
  content = "",
  turnScopeId = "",
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
} = {}) {
  return createCommandRequestHash({
    type: "session.turn.commit",
    action: normalizeTurnCommitAction(action),
    content: clean(content),
    turnScopeId: clean(turnScopeId),
    resumeDialogProcessId: clean(resumeDialogProcessId),
    resumeTurnScopeId: clean(resumeTurnScopeId),
  });
}
