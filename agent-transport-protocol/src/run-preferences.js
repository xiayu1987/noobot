/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  SECURITY_RISK_LEVEL,
  SECURITY_RISK_LEVELS,
  normalizeSecurityRiskLevel,
} from "@noobot/security-assessment-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
const SUMMARY_POLICY_KEYS = Object.freeze(["phaseSummaryLoopTurns", "taskCheckLoopTurns"]);
const PREFERENCE_FLAG_KEYS = Object.freeze([
  "allowUserInteraction",
  "safeConfirm",
  "sanitizeOutput",
  "streaming",
]);
const PREFERENCE_KEYS = new Set([
  ...PREFERENCE_FLAG_KEYS,
  "frontendThresholdsEnabled",
  "safeConfirmLevel",
  "locale",
  "scenario",
  "selectedModel",
  "memoryModel",
  "pluginModelConfig",
  "summaryPolicy",
  "selectedPlugins",
]);

const clean = (value) => text(value);

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))];
}

function pluginModelConfig(value) {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value).filter(([key, item]) => clean(key) && isPlainObject(item));
  return entries.length
    ? Object.fromEntries(entries.map(([key, item]) => [clean(key), { ...item }]))
    : undefined;
}

function summaryPolicy(value) {
  if (!isPlainObject(value)) return undefined;
  const phaseSummaryLoopTurns = Number(value.phaseSummaryLoopTurns);
  const taskCheckLoopTurns = Number(value.taskCheckLoopTurns);
  const normalized = {};
  if (Number.isInteger(phaseSummaryLoopTurns) && phaseSummaryLoopTurns > 0) {
    normalized.phaseSummaryLoopTurns = phaseSummaryLoopTurns;
  }
  if (Number.isInteger(taskCheckLoopTurns) && taskCheckLoopTurns > 0) {
    normalized.taskCheckLoopTurns = taskCheckLoopTurns;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export function createRunPreferences(input = {}) {
  const safeConfirmLevel = normalizeSecurityRiskLevel(
    input.safeConfirmLevel,
    SECURITY_RISK_LEVEL.LOW,
  );
  const normalizedPluginModelConfig = pluginModelConfig(input.pluginModelConfig);
  const normalizedSummaryPolicy = summaryPolicy(input.summaryPolicy);
  return {
    allowUserInteraction: input.allowUserInteraction !== false,
    safeConfirm: input.safeConfirm !== false,
    sanitizeOutput: input.sanitizeOutput !== false,
    streaming: input.streaming === true,
    frontendThresholdsEnabled: input.frontendThresholdsEnabled === true,
    safeConfirmLevel,
    locale: clean(input.locale),
    scenario: clean(input.scenario),
    selectedModel: clean(input.selectedModel),
    memoryModel: clean(input.memoryModel),
    ...(normalizedPluginModelConfig ? { pluginModelConfig: normalizedPluginModelConfig } : {}),
    ...(normalizedSummaryPolicy ? { summaryPolicy: normalizedSummaryPolicy } : {}),
    selectedPlugins: stringList(input.selectedPlugins),
  };
}

function validateExecutionPreferenceFields(source) {
  const errors = [];
  for (const key of PREFERENCE_FLAG_KEYS) {
    if (typeof source[key] !== "boolean") errors.push(`invalid_${key}`);
  }
  if (typeof source.frontendThresholdsEnabled !== "boolean") {
    errors.push("invalid_frontend_thresholds_enabled");
  }
  if (!SECURITY_RISK_LEVELS.includes(source.safeConfirmLevel)) {
    errors.push("invalid_safe_confirm_level");
  }
  return errors;
}

export function assertRunConfigPreferences(runConfig) {
  if (!isPlainObject(runConfig)) throw new TypeError("run_config_not_object");
  const errors = validateExecutionPreferenceFields(runConfig);
  if (errors.length) throw new TypeError(`invalid_run_config_preferences:${errors.join(",")}`);
  return runConfig;
}

export function validateRunPreferences(preferences) {
  const errors = [];
  if (!isPlainObject(preferences)) {
    return { valid: false, errors: ["preferences_not_object"] };
  }
  for (const key of Object.keys(preferences)) {
    if (!PREFERENCE_KEYS.has(key)) errors.push(`unknown_preferences_field:${key}`);
  }
  errors.push(...validateExecutionPreferenceFields(preferences));
  if (
    !Array.isArray(preferences.selectedPlugins) ||
    preferences.selectedPlugins.some((item) => typeof item !== "string")
  ) {
    errors.push("invalid_selected_plugins");
  }
  if (
    Object.prototype.hasOwnProperty.call(preferences, "pluginModelConfig") &&
    !isPlainObject(preferences.pluginModelConfig)
  ) {
    errors.push("invalid_plugin_model_config");
  }
  if (Object.prototype.hasOwnProperty.call(preferences, "summaryPolicy")) {
    const policy = preferences.summaryPolicy;
    if (!isPlainObject(policy)) {
      errors.push("invalid_summary_policy");
    } else {
      for (const key of Object.keys(policy)) {
        if (!SUMMARY_POLICY_KEYS.includes(key)) errors.push(`unknown_summary_policy_field:${key}`);
      }
      if (
        Object.prototype.hasOwnProperty.call(policy, "phaseSummaryLoopTurns") &&
        (!Number.isInteger(policy.phaseSummaryLoopTurns) || policy.phaseSummaryLoopTurns <= 0)
      ) {
        errors.push("invalid_phase_summary_loop_turns");
      }
      if (
        Object.prototype.hasOwnProperty.call(policy, "taskCheckLoopTurns") &&
        (!Number.isInteger(policy.taskCheckLoopTurns) || policy.taskCheckLoopTurns <= 0)
      ) {
        errors.push("invalid_task_check_loop_turns");
      }
      if (!Object.keys(policy).length) errors.push("empty_summary_policy");
    }
  }
  return { valid: errors.length === 0, errors };
}
