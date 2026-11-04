/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveActiveDynamicPolicyPromptFromContext } from "./dynamic-policy-prompt.js";
import { text } from "@noobot/shared/value";

export const HARNESS_SCENARIO = Object.freeze({
  GENERAL: "general",
  TEXT: "text",
  PROGRAMMING: "programming",
});

function normalizeScenarioKey(value = "") {
  return text(value);
}

function isProgrammingScenarioKey(value = "") {
  return normalizeScenarioKey(value) === HARNESS_SCENARIO.PROGRAMMING;
}

function isTextScenarioKey(value = "") {
  return normalizeScenarioKey(value) === HARNESS_SCENARIO.TEXT;
}

export function resolveHarnessScenarioFromOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  if (isProgrammingScenarioKey(source.scenario)) return HARNESS_SCENARIO.PROGRAMMING;
  if (isTextScenarioKey(source.scenario)) return HARNESS_SCENARIO.TEXT;
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveHarnessScenarioFromContext(ctx = {}, options = {}) {
  if (Object.hasOwn(options, "scenario")) {
    return resolveHarnessScenarioFromOptions(options);
  }
  const runConfig = Object.hasOwn(ctx, "runConfig")
    ? ctx.runConfig
    : ctx?.agentContext?.bindings?.runtime?.runConfig;
  if (isProgrammingScenarioKey(runConfig?.scenario)) return HARNESS_SCENARIO.PROGRAMMING;
  if (isTextScenarioKey(runConfig?.scenario)) return HARNESS_SCENARIO.TEXT;
  return HARNESS_SCENARIO.GENERAL;
}

export function resolveWorkflowThresholdModeFromContext(ctx = {}) {
  const scenario = resolveHarnessScenarioFromContext(ctx);
  if (scenario === HARNESS_SCENARIO.PROGRAMMING) return "programming";
  if (scenario === HARNESS_SCENARIO.TEXT) return "text";
  return "full";
}

export function resolveScenarioPolicyFlagsFromContext(ctx = {}) {
  const dynamicPolicyPromptRecord = resolveActiveDynamicPolicyPromptFromContext(ctx);
  const scenario = dynamicPolicyPromptRecord
    ? dynamicPolicyPromptRecord.scenario
    : resolveHarnessScenarioFromContext(ctx);
  return {
    scenario,
    dynamicPolicyPrompt: dynamicPolicyPromptRecord?.prompt || "",
    dynamicPolicyPromptRecord,
  };
}
