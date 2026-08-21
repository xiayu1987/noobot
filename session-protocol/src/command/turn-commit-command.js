/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCommandRequestHash } from "./command-fingerprint.js";

const clean = (value) => String(value || "").trim();

export function createTurnCommitFingerprint({
  action = "send",
  content = "",
  turnScopeId = "",
  resumeDialogProcessId = "",
  resumeTurnScopeId = "",
} = {}) {
  return createCommandRequestHash({
    type: "session.turn.commit",
    action: clean(action).toLowerCase(),
    content: clean(content),
    turnScopeId: clean(turnScopeId),
    resumeDialogProcessId: clean(resumeDialogProcessId),
    resumeTurnScopeId: clean(resumeTurnScopeId),
  });
}
