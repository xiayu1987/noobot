/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_TASK_SUMMARY_TOOL_NAME } from "./summary-policy.js";

export const MAIN_CONTEXT_POLICY = Object.freeze({
  policyVersion: 1,
  summaryToolName: DEFAULT_TASK_SUMMARY_TOOL_NAME,
  preserveLatestInjectionPerType: true,
  requireToolPairClosure: true,
  excludeActiveExecutionFromHistory: true,
  appendCanonicalUserToIncremental: true,
});
