/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS } from "../../../config/index.js";
import { resolveDefaultModelSpec } from "../../../model/index.js";
export function resolvePhaseSummaryLoopTurns(_effectiveConfig = {}) {
  return BUILTIN_THRESHOLDS.taskSummary.phaseSummaryLoopTurns;
}

export function resolvePhaseSummaryMessageCharsThreshold(_effectiveConfig = {}) {
  return BUILTIN_THRESHOLDS.taskSummary.phaseSummaryMessageCharsThreshold;
}

export function resolveHelpPromptLoopTurns(_effectiveConfig = {}) {
  return BUILTIN_THRESHOLDS.requestHelp.helpPromptLoopTurns;
}

export function resolveToolFailureHelpCount(_effectiveConfig = {}) {
  return BUILTIN_THRESHOLDS.requestHelp.toolFailureHelpCount;
}

export function resolveMaxToolLoopTurns({ systemRuntime: _systemRuntime = {}, effectiveConfig: _effectiveConfig = {} } = {}) {
  return BUILTIN_THRESHOLDS.maxToolLoopTurns;
}

export function resolveEffectiveModelSpec({ globalConfig = {}, userConfig = {} } = {}) {
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}
