/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import { selectModelAlias } from "@noobot/agent-config-protocol";
import {
  resolveModelSpecByName,
  resolveModelSpecOrConfiguredDefault,
} from "../../models/index.js";
export function resolvePhaseSummaryLoopTurns({ runConfig = {} } = {}) {
  const runtimeThreshold = Number(runConfig?.summaryPolicy?.phaseSummaryLoopTurns);
  if (runConfig?.frontendThresholdsEnabled === true && Number.isInteger(runtimeThreshold) && runtimeThreshold > 0) {
    return runtimeThreshold;
  }
  return BUILTIN_THRESHOLDS.taskSummary.phaseSummaryLoopTurns;
}

export function resolveTaskCheckLoopTurns({ runConfig = {} } = {}) {
  const runtimeThreshold = Number(runConfig?.summaryPolicy?.taskCheckLoopTurns);
  if (runConfig?.frontendThresholdsEnabled === true && Number.isInteger(runtimeThreshold) && runtimeThreshold > 0) {
    return runtimeThreshold;
  }
  return BUILTIN_THRESHOLDS.taskCheck.taskCheckLoopTurns;
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

export function resolveEffectiveModelSpec({
  globalConfig = {},
  userConfig = {},
  selectedModel = "",
  scenario = "",
} = {}) {
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const selection = selectModelAlias({ selectedModel, scenario, effectiveConfig });
  if (selection.source === "requested") {
    const selectedOrDefaultModelSpec = resolveModelSpecOrConfiguredDefault({
      name: selection.alias,
      globalConfig,
      userConfig,
    });
    if (!selectedOrDefaultModelSpec) {
      throw new Error(`selected model not found: ${selection.alias}`);
    }
    return selectedOrDefaultModelSpec;
  }
  return resolveModelSpecByName({
    name: selection.alias,
    globalConfig,
    userConfig,
  });
}
