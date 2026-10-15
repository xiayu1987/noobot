/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

const WORKFLOW_CORE_ERROR = Object.freeze({
  HOOK_MANAGER_REQUIRED: "workflow plugin requires a bot hook manager with on()",
});

export function formatWorkflowCoreError(code = "") {
  return WORKFLOW_CORE_ERROR[text(code)] || "";
}
