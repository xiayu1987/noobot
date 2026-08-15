/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import {
  resolveDefaultModelSpec,
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
  const normalizedSelectedModel = normalizeModelCandidate(readModelValue(selectedModel));
  if (normalizedSelectedModel) {
    const selectedOrDefaultModelSpec = resolveModelSpecOrConfiguredDefault({
      name: normalizedSelectedModel,
      globalConfig,
      userConfig,
    });
    if (!selectedOrDefaultModelSpec) {
      throw new Error(
        `selected model not found and no configured default model is available: ${normalizedSelectedModel}`,
      );
    }
    return selectedOrDefaultModelSpec;
  }
  const scenarioModelSpec = resolveScenarioDefaultModelSpec({
    globalConfig,
    userConfig,
    scenario,
  });
  if (scenarioModelSpec) return scenarioModelSpec;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

function normalizeModelCandidate(value = "") {
  return String(value || "").trim();
}

function readModelValue(modelConfig = {}) {
  if (typeof modelConfig === "string") return modelConfig;
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) return "";
  return (
    modelConfig.value ||
    modelConfig.alias ||
    modelConfig.key ||
    modelConfig.model ||
    ""
  );
}

function readScenarioDefinition(sourceConfig = {}, scenarioKey = "") {
  const definitions =
    sourceConfig?.scenarios?.definitions &&
    typeof sourceConfig.scenarios.definitions === "object" &&
    !Array.isArray(sourceConfig.scenarios.definitions)
      ? sourceConfig.scenarios.definitions
      : {};
  const definition = definitions?.[scenarioKey];
  return definition && typeof definition === "object" && !Array.isArray(definition)
    ? definition
    : {};
}

function resolveScenarioDefaultModelSpec({
  globalConfig = {},
  userConfig = {},
  scenario = "",
} = {}) {
  const scenarioKey = normalizeModelCandidate(scenario);
  if (!scenarioKey) return null;

  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const scenarioDefinition = readScenarioDefinition(effectiveConfig, scenarioKey);
  const modelName = normalizeModelCandidate(scenarioDefinition?.model);
  if (!modelName) return null;
  return resolveModelSpecByName({
    name: modelName,
    globalConfig,
    userConfig,
  });
}
