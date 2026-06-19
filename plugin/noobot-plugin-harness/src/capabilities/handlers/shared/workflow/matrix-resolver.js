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

export function normalizeScenarioText(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isProgrammingScenarioText(value = "") {
  const text = normalizeScenarioText(value);
  return text === "programming" ||
    text === "coding" ||
    text.includes("programming") ||
    text.includes("coding") ||
    text.includes("\u7f16\u7a0b");
}

export function isTextScenarioText(value = "") {
  const text = normalizeScenarioText(value);
  return text === "text" || text.includes("text") || text.includes("\u6587\u672c");
}

export function resolveRunConfigCandidatesFromContext(ctx = {}) {
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || ctx?.runtime || null;
  return [
    ctx?.runConfig,
    runtime?.runConfig,
    runtime?.systemRuntime?.runConfig,
    ctx?.agentContext?.runConfig,
  ].filter((item) => item && typeof item === "object");
}

export function resolveHarnessOptionCandidates(ctx = {}, meta = {}) {
  const runConfigs = resolveRunConfigCandidatesFromContext(ctx);
  return [
    meta?.harness,
    ...runConfigs.map((item) => item?.plugins?.harness),
    ...runConfigs.map((item) => item?.harness),
  ].filter((item) => item && typeof item === "object");
}

function scenarioCandidatesFromOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  return [
    source.scenario,
    source.scenarioKey,
    source.scenarioProfile?.key,
    source.scenarioProfile?.name,
    data.scenario,
    data.scenarioKey,
    data.scenarioProfile?.key,
    data.scenarioProfile?.name,
  ];
}

function scenarioCandidatesFromRunConfig(runConfig = {}) {
  return [
    runConfig?.scenario,
    runConfig?.scenarioKey,
    runConfig?.scenarioProfile?.key,
    runConfig?.scenarioProfile?.name,
  ];
}

export function resolveHarnessScenarioFromOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  if (source.programmingMode === true || source.isProgrammingMode === true || data.programmingMode === true) {
    return HARNESS_SCENARIO.PROGRAMMING;
  }
  if (source.textMode === true || source.isTextMode === true || data.textMode === true || data.isTextMode === true) {
    return HARNESS_SCENARIO.TEXT;
  }
  for (const candidate of scenarioCandidatesFromOptions(source)) {
    if (isProgrammingScenarioText(candidate)) return HARNESS_SCENARIO.PROGRAMMING;
    if (isTextScenarioText(candidate)) return HARNESS_SCENARIO.TEXT;
  }
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveHarnessScenarioFromContext(ctx = {}, options = {}) {
  const optionScenario = resolveHarnessScenarioFromOptions(options);
  if (optionScenario !== HARNESS_SCENARIO.GENERAL) return optionScenario;
  for (const runConfig of resolveRunConfigCandidatesFromContext(ctx)) {
    for (const candidate of scenarioCandidatesFromRunConfig(runConfig)) {
      if (isProgrammingScenarioText(candidate)) return HARNESS_SCENARIO.PROGRAMMING;
      if (isTextScenarioText(candidate)) return HARNESS_SCENARIO.TEXT;
    }
  }
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveHarnessScenarioMode(ctx = {}, options = {}) {
  return Object.freeze({
    scenario: resolveHarnessScenarioFromContext(ctx, options),
  });
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

export function resolvePromptWorkflowStrategy() {
  return "";
}

export function resolveWorkflowStrategyFromContext() {
  return "";
}

export function resolveNonProgrammingExecutionFirstFromContext() {
  return true;
}

export function resolveExecutionFirstModeFromContext() {
  return true;
}

export function resolveRiskFirstModeFromContext() {
  return false;
}

export function resolveWorkflowStrategyFlagsFromContext(ctx = {}) {
  const dynamicPolicyPromptRecord = resolveActiveDynamicPolicyPromptFromContext(ctx);
  const dynamicScenario = String(dynamicPolicyPromptRecord?.scenario || "").trim();
  const dynamicProgrammingMode = dynamicScenario === HARNESS_SCENARIO.PROGRAMMING;
  const dynamicTextMode = dynamicScenario === HARNESS_SCENARIO.TEXT;
  const programmingMode = dynamicProgrammingMode || (
    !dynamicTextMode &&
    resolveProgrammingModeFromContext(ctx)
  );
  const textMode = !programmingMode && (
    dynamicTextMode ||
    resolveTextModeFromContext(ctx)
  );
  return {
    programmingMode,
    textMode,
    executionFirstMode: true,
    riskFirstMode: false,
    dynamicPolicyPrompt: dynamicPolicyPromptRecord?.prompt || "",
    dynamicPolicyPromptRecord,
  };
}
