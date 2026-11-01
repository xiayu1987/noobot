/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_DATA_SCOPE, resolveWorkflowDataRelativePath } from "../constants.js";
import { isCanonicalText } from "@noobot/shared/value";

export function buildWorkflowDialogRelativeDir({ ctx, dialogProcessId }) {
  const sessionId = ctx.sessionId;
  if (!isCanonicalText(sessionId) || !isCanonicalText(dialogProcessId)) {
    throw new TypeError("workflow dialog directory requires canonical session and dialog identity");
  }
  return resolveWorkflowDataRelativePath(WORKFLOW_DATA_SCOPE.SESSION, sessionId, dialogProcessId);
}
