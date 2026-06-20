/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../../config/index.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../../../model/index.js";
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

export function resolveEffectiveModelSpec({
  globalConfig = {},
  userConfig = {},
  selectedModel = "",
  scenario = "",
} = {}) {
  const normalizedSelectedModel = normalizeModelCandidate(readModelValue(selectedModel));
  if (normalizedSelectedModel) {
    const selectedModelSpec = resolveModelSpecByName({
      name: normalizedSelectedModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (selectedModelSpec) return selectedModelSpec;
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

function readFirstEnabledModelValue(enabledModels = []) {
  const models = Array.isArray(enabledModels) ? enabledModels : [];
  if (!models.length) return "";
  return readModelValue(models[0]);
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

function pushScenarioCandidateGroup(candidates = [], definitions = [], reader = () => "") {
  for (const definition of definitions) {
    const value = reader(definition || {});
    if (normalizeModelCandidate(value)) candidates.push(value);
  }
}

function resolveScenarioDefaultModelSpec({
  globalConfig = {},
  userConfig = {},
  scenario = "",
} = {}) {
  const scenarioKey = normalizeModelCandidate(scenario);
  if (!scenarioKey) return null;

  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const scenarioDefinitions = [
    readScenarioDefinition(userConfig, scenarioKey),
    readScenarioDefinition(globalConfig, scenarioKey),
    readScenarioDefinition(effectiveConfig, scenarioKey),
  ];
  const candidates = [];
  pushScenarioCandidateGroup(candidates, scenarioDefinitions, (definition) => definition?.defaultModelAlias);
  pushScenarioCandidateGroup(candidates, scenarioDefinitions, (definition) => readModelValue(definition?.defaultModel));
  pushScenarioCandidateGroup(candidates, scenarioDefinitions, (definition) => definition?.model);
  pushScenarioCandidateGroup(candidates, scenarioDefinitions, (definition) => readFirstEnabledModelValue(definition?.enabledModels));
  candidates.push(
    userConfig?.defaultModelAlias,
    globalConfig?.defaultModelAlias,
    effectiveConfig?.defaultModelAlias,
    readModelValue(userConfig?.defaultModel),
    readModelValue(globalConfig?.defaultModel),
    readModelValue(effectiveConfig?.defaultModel),
    readFirstEnabledModelValue(userConfig?.enabledModels),
    readFirstEnabledModelValue(globalConfig?.enabledModels),
    readFirstEnabledModelValue(effectiveConfig?.enabledModels),
  );

  for (const candidate of candidates) {
    const modelName = normalizeModelCandidate(candidate);
    if (!modelName) continue;
    const modelSpec = resolveModelSpecByName({
      name: modelName,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (modelSpec) return modelSpec;
  }
  return null;
}
