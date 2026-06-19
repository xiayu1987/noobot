/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { normalizeWorkflowStrategyName } from "../../../../core/workflow-strategy.js";
import { resolveActiveDynamicPolicyPromptFromContext } from "./dynamic-policy-prompt.js";

export const HARNESS_SCENARIO = Object.freeze({
  GENERAL: "general",
  TEXT: "text",
  PROGRAMMING: "programming",
});

export const HARNESS_WORKFLOW_MODE = Object.freeze({
  BASE: "base",
  EXECUTION_FIRST: WORKFLOW_PARAMS.workflow.strategy.modes.executionFirst,
  RISK_FIRST: WORKFLOW_PARAMS.workflow.strategy.modes.riskFirst,
});

const WORKFLOW_STRATEGY_MODES = WORKFLOW_PARAMS.workflow.strategy.modes;

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

export function readFirstBooleanOption(candidates = [], keys = []) {
  for (const source of Array.isArray(candidates) ? candidates : []) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (typeof source?.[key] === "boolean") return source[key];
    }
  }
  return undefined;
}

export function readFirstStringOption(candidates = [], keys = []) {
  for (const source of Array.isArray(candidates) ? candidates : []) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    const nested = source?.workflowStrategy;
    if (nested && typeof nested === "object" && typeof nested.nonProgramming === "string") {
      return nested.nonProgramming;
    }
  }
  return "";
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

export function resolvePromptWorkflowStrategy(source = {}, data = {}) {
  const candidates = [
    source.nonProgrammingWorkflowStrategy,
    source.promptStrategy,
    source.workflowMode,
    source.workflowStrategy?.nonProgramming,
    source.workflowStrategy,
    data.nonProgrammingWorkflowStrategy,
    data.promptStrategy,
    data.workflowMode,
    data.workflowStrategy?.nonProgramming,
    data.workflowStrategy,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeWorkflowStrategyName(candidate);
    if (normalized) return normalized;
  }
  if (source.riskFirstMode === true || source.isRiskFirstMode === true || data.riskFirstMode === true) {
    return WORKFLOW_STRATEGY_MODES.riskFirst;
  }
  if (
    source.executionFirstMode === true ||
    source.isExecutionFirstMode === true ||
    source.nonProgrammingExecutionFirst === true ||
    data.executionFirstMode === true ||
    data.nonProgrammingExecutionFirst === true
  ) return WORKFLOW_STRATEGY_MODES.executionFirst;
  return "";
}

export function resolveHarnessWorkflowModeFromOptions(options = {}, { scenario = undefined } = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  const resolvedScenario = scenario || resolveHarnessScenarioFromOptions(source);
  if (resolvedScenario === HARNESS_SCENARIO.PROGRAMMING) return HARNESS_WORKFLOW_MODE.EXECUTION_FIRST;
  const workflowStrategy = resolvePromptWorkflowStrategy(source, data);
  if (
    workflowStrategy === WORKFLOW_STRATEGY_MODES.executionFirst ||
    source.executionFirstMode === true ||
    source.isExecutionFirstMode === true ||
    source.nonProgrammingExecutionFirst === true ||
    data.executionFirstMode === true ||
    data.nonProgrammingExecutionFirst === true
  ) return HARNESS_WORKFLOW_MODE.EXECUTION_FIRST;
  if (
    workflowStrategy === WORKFLOW_STRATEGY_MODES.riskFirst ||
    source.riskFirstMode === true ||
    source.isRiskFirstMode === true ||
    source.nonProgrammingExecutionFirst === false ||
    data.riskFirstMode === true ||
    data.nonProgrammingExecutionFirst === false
  ) return HARNESS_WORKFLOW_MODE.RISK_FIRST;
  return HARNESS_WORKFLOW_MODE.BASE;
}

export function resolveHarnessScenarioMode(ctx = {}, options = {}) {
  const scenario = resolveHarnessScenarioFromContext(ctx, options);
  return Object.freeze({
    scenario,
    workflowMode: resolveHarnessWorkflowModeFromOptions(options, { scenario }),
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

export function resolveWorkflowStrategyFromContext(ctx = {}, meta = {}) {
  if (resolveProgrammingModeFromContext(ctx)) {
    return WORKFLOW_PARAMS.workflow.strategy.programming.mode;
  }
  const nonProgrammingStrategyParams = WORKFLOW_PARAMS.workflow.strategy.nonProgramming;
  const candidates = resolveHarnessOptionCandidates(ctx, meta);
  const explicitStrategy = normalizeWorkflowStrategyName(
    readFirstStringOption(candidates, nonProgrammingStrategyParams.optionKeys),
  );
  if (
    explicitStrategy &&
    nonProgrammingStrategyParams.supportedModes.includes(explicitStrategy)
  ) return explicitStrategy;
  const legacyExecutionFirst = readFirstBooleanOption(
    candidates,
    nonProgrammingStrategyParams.legacyExecutionFirstBooleanOptionKeys,
  );
  if (typeof legacyExecutionFirst === "boolean") {
    return legacyExecutionFirst
      ? WORKFLOW_STRATEGY_MODES.executionFirst
      : WORKFLOW_STRATEGY_MODES.riskFirst;
  }
  return nonProgrammingStrategyParams.defaultMode;
}

export function resolveNonProgrammingExecutionFirstFromContext(ctx = {}, meta = {}) {
  if (resolveProgrammingModeFromContext(ctx)) return true;
  return resolveWorkflowStrategyFromContext(ctx, meta) === WORKFLOW_STRATEGY_MODES.executionFirst;
}

export function resolveExecutionFirstModeFromContext(ctx = {}, meta = {}) {
  return resolveWorkflowStrategyFromContext(ctx, meta) === WORKFLOW_STRATEGY_MODES.executionFirst;
}

export function resolveRiskFirstModeFromContext(ctx = {}, meta = {}) {
  return resolveWorkflowStrategyFromContext(ctx, meta) === WORKFLOW_STRATEGY_MODES.riskFirst;
}

export function resolveWorkflowStrategyFlagsFromContext(ctx = {}, meta = {}) {
  const dynamicPolicyPromptRecord = resolveActiveDynamicPolicyPromptFromContext(ctx);
  const dynamicScenario = String(dynamicPolicyPromptRecord?.scenario || "").trim();
  const dynamicWorkflowMode = normalizeWorkflowStrategyName(dynamicPolicyPromptRecord?.workflowMode || "");
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
  const workflowStrategy = programmingMode
    ? WORKFLOW_STRATEGY_MODES.executionFirst
    : dynamicWorkflowMode || resolveWorkflowStrategyFromContext(ctx, meta);
  return {
    programmingMode,
    textMode,
    workflowStrategy,
    executionFirstMode: programmingMode || workflowStrategy === WORKFLOW_STRATEGY_MODES.executionFirst,
    riskFirstMode: !programmingMode && workflowStrategy === WORKFLOW_STRATEGY_MODES.riskFirst,
    dynamicPolicyPrompt: dynamicPolicyPromptRecord?.prompt || "",
    dynamicPolicyPromptRecord,
  };
}
