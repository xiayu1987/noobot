/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_DATA_SCOPE, resolveWorkflowDataRelativePath } from "../constants.js";
import { text } from "@noobot/shared/value";

export function buildWorkflowDialogRelativeDir({ ctx = {}, dialogProcessId = "" } = {}) {
  const sessionId = ctx.sessionId;
  const nodeDialogProcessId = text(dialogProcessId);
  if (!sessionId || !nodeDialogProcessId) return "";
  return resolveWorkflowDataRelativePath(
    WORKFLOW_DATA_SCOPE.SESSION,
    sessionId,
    nodeDialogProcessId,
  );
}
