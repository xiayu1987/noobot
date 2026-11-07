/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { mergeConfig } from "../../config/index.js";
import {
  isRuntimeThresholdGateEnabled,
  resolveGatedThresholdValue,
  selectModelAlias,
  requireModelReference,
} from "@noobot/agent-config-protocol";
import { resolveModelSpecByName } from "../../models/index.js";
export function resolvePhaseSummaryLoopTurns({ runConfig = {} } = {}) {
  return resolveGatedThresholdValue({
    enabled: isRuntimeThresholdGateEnabled(runConfig),
    runtimeValue: runConfig?.summaryPolicy?.phaseSummaryLoopTurns,
    fallbackValue: TURN_THRESHOLDS.agent.phaseSummaryLoopTurns,
  });
}

export function resolveTaskCheckLoopTurns({ runConfig = {} } = {}) {
  return resolveGatedThresholdValue({
    enabled: isRuntimeThresholdGateEnabled(runConfig),
    runtimeValue: runConfig?.summaryPolicy?.taskCheckLoopTurns,
    fallbackValue: TURN_THRESHOLDS.agent.taskCheckLoopTurns,
  });
}

function modelSelectionPath(selection, scenario) {
  if (selection.source === "scenario") return ["scenarios", "definitions", scenario, "model"];
  if (selection.source === "requested") return ["selectedModel"];
  return ["default_provider"];
}

export function resolveEffectiveModelSpec({
  globalConfig = {},
  userConfig = {},
  selectedModel = "",
  scenario = "",
} = {}) {
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const selection = selectModelAlias({ selectedModel, scenario, effectiveConfig });
  const provider = resolveModelSpecByName({
    modelName: selection.alias,
    globalConfig,
    userConfig,
  });
  return requireModelReference({
    provider,
    alias: selection.alias,
    requirement: "conversation",
    path: modelSelectionPath(selection, scenario),
  });
}
