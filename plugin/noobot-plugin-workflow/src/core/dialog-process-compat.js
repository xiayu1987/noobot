/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// Compatibility boundary for old workflow action/run/completed-result records.
// New code must write nodeDialogProcessId; nodeDialogId is a read-only legacy alias.
export function resolveWorkflowNodeDialogProcessId(item = {}) {
  return String(item?.nodeDialogProcessId || item?.nodeDialogId || "").trim();
}
