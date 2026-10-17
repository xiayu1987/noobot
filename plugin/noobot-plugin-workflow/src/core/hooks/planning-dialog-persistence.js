/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isWorkflowNodeDialogProcessId } from "@noobot/session-protocol/turn-scope-identity";
import { WORKFLOW_DATA_SCOPE, resolveWorkflowDataRelativePath } from "../constants.js";
import { text } from "@noobot/shared/value";

export function buildWorkflowDialogRelativeDir({
  ctx = {},
  dialogProcessId = "",
  scope = "auto",
} = {}) {
  const sessionId = text(ctx?.sessionId);
  const resolvedDialogProcessId = text(dialogProcessId || ctx?.dialogProcessId);
  if (!sessionId || !resolvedDialogProcessId) return "";
  const normalizedScope = (text(scope) || "auto").toLowerCase();
  const isNodeDialog =
    normalizedScope === "node" ||
    (normalizedScope !== "planning" && isWorkflowNodeDialogProcessId(resolvedDialogProcessId));
  return resolveWorkflowDataRelativePath(
    isNodeDialog ? WORKFLOW_DATA_SCOPE.SESSION : WORKFLOW_DATA_SCOPE.PLANNING,
    sessionId,
    resolvedDialogProcessId,
  );
}
