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
const SUMMARY_POLICY_FIELDS = Object.freeze([
  { key: "phaseSummaryLoopTurns", error: "invalid_phase_summary_loop_turns" },
  { key: "taskCheckLoopTurns", error: "invalid_task_check_loop_turns" },
]);
const SUMMARY_POLICY_KEYS = new Set(SUMMARY_POLICY_FIELDS.map(({ key }) => key));
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
  const normalized = {};
  for (const { key } of SUMMARY_POLICY_FIELDS) {
    const turns = Number(value[key]);
    if (Number.isInteger(turns) && turns > 0) normalized[key] = turns;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function validateSummaryPolicy(policy) {
  if (!isPlainObject(policy)) return ["invalid_summary_policy"];
  const errors = Object.keys(policy)
    .filter((key) => !SUMMARY_POLICY_KEYS.has(key))
    .map((key) => `unknown_summary_policy_field:${key}`);
  for (const { key, error } of SUMMARY_POLICY_FIELDS) {
    if (Object.hasOwn(policy, key) && (!Number.isInteger(policy[key]) || policy[key] <= 0)) {
      errors.push(error);
    }
  }
  if (!Object.keys(policy).length) errors.push("empty_summary_policy");
  return errors;
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
    errors.push(...validateSummaryPolicy(preferences.summaryPolicy));
  }
  return { valid: errors.length === 0, errors };
}
