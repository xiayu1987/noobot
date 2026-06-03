/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WORKFLOW_CORE_ERROR = Object.freeze({
  HOOK_MANAGER_REQUIRED: "workflow plugin requires a bot hook manager with on()",
  WORKFLOW_LIB_MISSING_FACADE: "workflow lib missing executeWorkflowSemantic facade",
});

export function formatWorkflowCoreError(code = "") {
  return WORKFLOW_CORE_ERROR[String(code || "").trim()] || "";
}

