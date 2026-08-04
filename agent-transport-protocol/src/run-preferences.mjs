/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const CONFIRMATION_LEVELS = new Set(["low", "medium", "high", "critical"]);
const CONNECTOR_KEYS = Object.freeze(["database", "terminal", "email"]);
const PREFERENCE_KEYS = new Set([
  "allowUserInteraction",
  "sanitizeOutput",
  "streaming",
  "confirmationLevel",
  "locale",
  "scenario",
  "selectedModel",
  "memoryModel",
  "pluginModelConfig",
  "selectedConnectors",
  "selectedPlugins",
]);

const clean = (value) => String(value ?? "").trim();

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))];
}

function selectedConnectors(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(CONNECTOR_KEYS.map((key) => [key, clean(source[key])]));
}

function pluginModelConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, item]) => (
    clean(key) && item && typeof item === "object" && !Array.isArray(item)
  ));
  return entries.length ? Object.fromEntries(entries.map(([key, item]) => [clean(key), { ...item }])) : undefined;
}

export function createRunPreferences(input = {}) {
  const confirmationLevel = clean(input.confirmationLevel).toLowerCase();
  const normalizedPluginModelConfig = pluginModelConfig(input.pluginModelConfig);
  return {
    allowUserInteraction: input.allowUserInteraction !== false,
    sanitizeOutput: input.sanitizeOutput !== false,
    ...(Object.prototype.hasOwnProperty.call(input, "streaming")
      ? { streaming: input.streaming === true }
      : {}),
    confirmationLevel: CONFIRMATION_LEVELS.has(confirmationLevel) ? confirmationLevel : "low",
    locale: clean(input.locale),
    scenario: clean(input.scenario),
    selectedModel: clean(input.selectedModel),
    memoryModel: clean(input.memoryModel),
    ...(normalizedPluginModelConfig ? { pluginModelConfig: normalizedPluginModelConfig } : {}),
    selectedConnectors: selectedConnectors(input.selectedConnectors),
    selectedPlugins: stringList(input.selectedPlugins),
  };
}

export function validateRunPreferences(preferences) {
  const errors = [];
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return { valid: false, errors: ["preferences_not_object"] };
  }
  for (const key of Object.keys(preferences)) {
    if (!PREFERENCE_KEYS.has(key)) errors.push(`unknown_preferences_field:${key}`);
  }
  for (const key of ["allowUserInteraction", "sanitizeOutput"]) {
    if (typeof preferences[key] !== "boolean") errors.push(`invalid_${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(preferences, "streaming") && typeof preferences.streaming !== "boolean") {
    errors.push("invalid_streaming");
  }
  if (!CONFIRMATION_LEVELS.has(clean(preferences.confirmationLevel).toLowerCase())) {
    errors.push("invalid_confirmation_level");
  }
  if (!Array.isArray(preferences.selectedPlugins) || preferences.selectedPlugins.some((item) => typeof item !== "string")) {
    errors.push("invalid_selected_plugins");
  }
  if (!preferences.selectedConnectors || typeof preferences.selectedConnectors !== "object" || Array.isArray(preferences.selectedConnectors)) {
    errors.push("invalid_selected_connectors");
  } else {
    for (const key of Object.keys(preferences.selectedConnectors)) {
      if (!CONNECTOR_KEYS.includes(key)) errors.push(`unknown_selected_connectors_field:${key}`);
    }
    if (Object.values(preferences.selectedConnectors).some((item) => typeof item !== "string")) {
      errors.push("invalid_selected_connectors");
    }
  }
  if (Object.prototype.hasOwnProperty.call(preferences, "pluginModelConfig") &&
      (!preferences.pluginModelConfig || typeof preferences.pluginModelConfig !== "object" || Array.isArray(preferences.pluginModelConfig))) {
    errors.push("invalid_plugin_model_config");
  }
  return { valid: errors.length === 0, errors };
}
