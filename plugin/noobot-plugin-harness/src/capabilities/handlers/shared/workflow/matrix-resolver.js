/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveActiveDynamicPolicyPromptFromContext } from "./dynamic-policy-prompt.js";

export const HARNESS_SCENARIO = Object.freeze({
  GENERAL: "general",
  TEXT: "text",
  PROGRAMMING: "programming",
});

function normalizeScenarioKey(value = "") {
  return String(value || "").trim();
}

function isProgrammingScenarioKey(value = "") {
  return normalizeScenarioKey(value) === HARNESS_SCENARIO.PROGRAMMING;
}

export function isTextScenarioKey(value = "") {
  return normalizeScenarioKey(value) === HARNESS_SCENARIO.TEXT;
}

function resolveRunConfigCandidatesFromContext(ctx = {}) {
  const runtime = ctx?.agentContext?.bindings?.runtime || null;
  return [
    ctx?.runConfig,
    runtime?.runConfig,
    runtime?.systemRuntime?.runConfig,
    ctx?.agentContext?.runConfig,
  ].filter((item) => item && typeof item === "object");
}

function scenarioCandidatesFromOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  return [
    source.scenario,
    source.scenarioKey,
    source.scenarioProfile?.key,
    data.scenario,
    data.scenarioKey,
    data.scenarioProfile?.key,
  ];
}

function scenarioCandidatesFromRunConfig(runConfig = {}) {
  return [runConfig?.scenario, runConfig?.scenarioKey, runConfig?.scenarioProfile?.key];
}

export function resolveHarnessScenarioFromOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  if (
    source.programmingMode === true ||
    source.isProgrammingMode === true ||
    data.programmingMode === true
  ) {
    return HARNESS_SCENARIO.PROGRAMMING;
  }
  if (
    source.textMode === true ||
    source.isTextMode === true ||
    data.textMode === true ||
    data.isTextMode === true
  ) {
    return HARNESS_SCENARIO.TEXT;
  }
  for (const candidate of scenarioCandidatesFromOptions(source)) {
    if (isProgrammingScenarioKey(candidate)) return HARNESS_SCENARIO.PROGRAMMING;
    if (isTextScenarioKey(candidate)) return HARNESS_SCENARIO.TEXT;
  }
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveHarnessScenarioFromContext(ctx = {}, options = {}) {
  const optionScenario = resolveHarnessScenarioFromOptions(options);
  if (optionScenario !== HARNESS_SCENARIO.GENERAL) return optionScenario;
  for (const runConfig of resolveRunConfigCandidatesFromContext(ctx)) {
    for (const candidate of scenarioCandidatesFromRunConfig(runConfig)) {
      if (isProgrammingScenarioKey(candidate)) return HARNESS_SCENARIO.PROGRAMMING;
      if (isTextScenarioKey(candidate)) return HARNESS_SCENARIO.TEXT;
    }
  }
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveWorkflowThresholdModeFromContext(ctx = {}) {
  const scenario = resolveHarnessScenarioFromContext(ctx);
  if (scenario === HARNESS_SCENARIO.PROGRAMMING) return "programming";
  if (scenario === HARNESS_SCENARIO.TEXT) return "text";
  return "full";
}

export function resolveProgrammingModeFromContext(ctx = {}) {
  return resolveWorkflowThresholdModeFromContext(ctx) === "programming";
}

export function resolveTextModeFromContext(ctx = {}) {
  return resolveWorkflowThresholdModeFromContext(ctx) === "text";
}

export function resolveScenarioPolicyFlagsFromContext(ctx = {}) {
  const dynamicPolicyPromptRecord = resolveActiveDynamicPolicyPromptFromContext(ctx);
  const dynamicScenario = String(dynamicPolicyPromptRecord?.scenario || "").trim();
  const dynamicProgrammingMode = dynamicScenario === HARNESS_SCENARIO.PROGRAMMING;
  const dynamicTextMode = dynamicScenario === HARNESS_SCENARIO.TEXT;
  const programmingMode =
    dynamicProgrammingMode || (!dynamicTextMode && resolveProgrammingModeFromContext(ctx));
  const textMode = !programmingMode && (dynamicTextMode || resolveTextModeFromContext(ctx));
  return {
    programmingMode,
    textMode,
    dynamicPolicyPrompt: dynamicPolicyPromptRecord?.prompt || "",
    dynamicPolicyPromptRecord,
  };
}
