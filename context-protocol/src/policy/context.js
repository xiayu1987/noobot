/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MAIN_CONTEXT_POLICY = Object.freeze({
  policyVersion: 1,
  flowControlRetention: "latest_per_tool_identity",
  preserveLatestInjectionPerType: true,
  requireToolPairClosure: true,
  excludeActiveExecutionFromHistory: true,
  appendCanonicalUserToIncremental: true,
});
