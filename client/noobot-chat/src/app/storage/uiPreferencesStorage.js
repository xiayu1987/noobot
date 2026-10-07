/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SECURITY_RISK_LEVEL,
  normalizeSecurityRiskLevel,
} from "@noobot/security-assessment-protocol";

export const UI_PREFERENCE_STORAGE_KEYS = Object.freeze({
  userId: "noobot_user_id",
  allowUserInteraction: "noobot_allow_user_interaction",
  safeConfirm: "noobot_safe_confirm",
  safeConfirmLevel: "noobot_safe_confirm_level",
  sanitizeOutput: "noobot_sanitize_output",
  streamOutput: "noobot_stream_output",
  botScenario: "noobot_bot_scenario",
  selectedModel: "noobot_selected_model",
  selectedModelByScenario: "noobot_selected_model_by_scenario",
  selectedModelSelectionByScenario: "noobot_selected_model_selection_by_scenario_v2",
  memoryModelByScenario: "noobot_memory_model_by_scenario_v1",
  pluginPreferences: "noobot_plugin_preferences",
});

export const PLUGIN_PREFERENCES_VERSION = 1;

const LEGACY_PLUGIN_PREFERENCE_STORAGE_KEYS = Object.freeze({
  global: "noobot_plugin_model_config",
  byScenario: "noobot_plugin_model_config_by_scenario_v2",
});

function getStorage() {
  return globalThis?.localStorage;
}

export function readStorageValue(key, fallback = "") {
  try {
    const value = getStorage()?.getItem?.(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeStorageValue(key, value) {
  try {
    getStorage()?.setItem?.(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorageValue(key) {
  try {
    getStorage()?.removeItem?.(key);
    return true;
  } catch {
    return false;
  }
}

export function normalizePreferenceString(value = "") {
  return String(value || "").trim();
}

export function normalizeScenarioPreferenceKey(value = "") {
  return normalizePreferenceString(value) || "__default__";
}

export function normalizeSelectedModelByScenarioPreference(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const nextValue = {};
  for (const [rawScenarioKey, rawModel] of Object.entries(value)) {
    const scenarioKey = normalizeScenarioPreferenceKey(rawScenarioKey);
    if (!scenarioKey) continue;
    nextValue[scenarioKey] = normalizePreferenceString(rawModel);
  }
  return nextValue;
}

export function normalizeSelectedModelSelectionByScenarioPreference(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const nextValue = {};
  for (const [rawScenarioKey, rawSelection] of Object.entries(value)) {
    const scenarioKey = normalizeScenarioPreferenceKey(rawScenarioKey);
    if (!scenarioKey) continue;
    if (typeof rawSelection === "string") continue;
    if (!rawSelection || typeof rawSelection !== "object" || Array.isArray(rawSelection)) continue;
    nextValue[scenarioKey] = {
      value: normalizePreferenceString(rawSelection.value),
      source: normalizePreferenceString(rawSelection.source) || "user",
    };
  }
  return nextValue;
}

export function normalizePluginModelConfig(value = {}) {
  const normalizeNode = (node) => {
    if (typeof node === "boolean") return node;
    if (typeof node === "string") return normalizePreferenceString(node);
    if (typeof node === "number") return Number.isFinite(node) ? node : undefined;
    if (Array.isArray(node)) {
      const nextArray = node
        .map((item) => normalizeNode(item))
        .filter((item) => {
          if (typeof item === "boolean") return true;
          if (typeof item === "number") return true;
          if (typeof item === "string") return Boolean(item);
          if (Array.isArray(item)) return item.length > 0;
          return item && typeof item === "object" && Object.keys(item).length > 0;
        });
      return nextArray.length ? nextArray : undefined;
    }
    if (!node || typeof node !== "object") return undefined;
    const nextObject = {};
    for (const [rawKey, rawValue] of Object.entries(node)) {
      const key = normalizePreferenceString(rawKey);
      if (!key) continue;
      const nextValue = normalizeNode(rawValue);
      if (typeof nextValue === "boolean") {
        nextObject[key] = nextValue;
        continue;
      }
      if (typeof nextValue === "number") {
        nextObject[key] = nextValue;
        continue;
      }
      if (typeof nextValue === "string") {
        if (nextValue) nextObject[key] = nextValue;
        continue;
      }
      if (Array.isArray(nextValue)) {
        if (nextValue.length) nextObject[key] = nextValue;
        continue;
      }
      if (nextValue && typeof nextValue === "object" && Object.keys(nextValue).length) {
        nextObject[key] = nextValue;
      }
    }
    return Object.keys(nextObject).length ? nextObject : undefined;
  };
  return normalizeNode(value) || {};
}

function isPlainPreferenceObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePreferenceNode(defaults, value) {
  if (!isPlainPreferenceObject(defaults) || !isPlainPreferenceObject(value)) {
    return typeof value === "undefined" ? defaults : value;
  }
  const merged = { ...defaults };
  for (const [key, child] of Object.entries(value)) {
    merged[key] = mergePreferenceNode(defaults[key], child);
  }
  return merged;
}

export function applyPluginPreferenceDefaults(value = {}, defaultsByPluginId = {}) {
  return normalizePluginModelConfig(
    mergePreferenceNode(
      normalizePluginModelConfig(defaultsByPluginId),
      normalizePluginModelConfig(value),
    ),
  );
}

export function normalizePluginModelConfigByScenarioPreference(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const nextValue = {};
  for (const [rawScenarioKey, rawConfig] of Object.entries(value)) {
    const scenarioKey = normalizeScenarioPreferenceKey(rawScenarioKey);
    if (!scenarioKey) continue;
    nextValue[scenarioKey] = normalizePluginModelConfig(rawConfig);
  }
  return nextValue;
}

export function readJsonStorageValue(key, fallback = {}) {
  try {
    const rawValue = readStorageValue(key, "");
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorageValue(key, value = {}) {
  return writeStorageValue(key, JSON.stringify(value && typeof value === "object" ? value : {}));
}

export function loadBooleanPreference(key, defaultValue = true) {
  const storedValue = readStorageValue(key, null);
  if (defaultValue) return storedValue !== "false";
  return storedValue === "true";
}

export function normalizeSafeConfirmLevel(value) {
  return normalizeSecurityRiskLevel(value, SECURITY_RISK_LEVEL.LOW);
}

export function persistBooleanPreference(key, value) {
  return writeStorageValue(key, Boolean(value) ? "true" : "false");
}

export function loadUiPreferences() {
  const botScenario = normalizePreferenceString(
    readStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, ""),
  );
  const selectedModelByScenario = loadSelectedModelByScenarioPreference();
  return {
    userId: readStorageValue(UI_PREFERENCE_STORAGE_KEYS.userId, "user-001") || "user-001",
    allowUserInteraction: loadBooleanPreference(
      UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction,
      true,
    ),
    safeConfirm: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.safeConfirm, true),
    safeConfirmLevel: normalizeSafeConfirmLevel(
      readStorageValue(UI_PREFERENCE_STORAGE_KEYS.safeConfirmLevel, SECURITY_RISK_LEVEL.LOW),
    ),
    sanitizeOutput: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.sanitizeOutput, true),
    streamOutput: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.streamOutput, false),
    botScenario,
    selectedModel: readSelectedModelPreference(botScenario),
    selectedModelByScenario,
    memoryModel: readMemoryModelPreference(botScenario),
    pluginModelConfig: readPluginModelConfigPreference(botScenario),
  };
}

export function persistBotScenarioPreference(value = "") {
  return writeStorageValue(
    UI_PREFERENCE_STORAGE_KEYS.botScenario,
    normalizePreferenceString(value),
  );
}

export function loadSelectedModelByScenarioPreference() {
  const selectedModelSelectionByScenario = loadSelectedModelSelectionByScenarioPreference();
  const selectedModelByScenario = {};
  for (const [scenarioKey, selection] of Object.entries(selectedModelSelectionByScenario)) {
    selectedModelByScenario[scenarioKey] = normalizePreferenceString(selection?.value);
  }
  return selectedModelByScenario;
}

export function loadSelectedModelSelectionByScenarioPreference() {
  return normalizeSelectedModelSelectionByScenarioPreference(
    readJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.selectedModelSelectionByScenario, {}),
  );
}

export function hasStoredSelectedModelPreference(scenarioKey = "") {
  return Object.prototype.hasOwnProperty.call(
    loadSelectedModelByScenarioPreference(),
    normalizeScenarioPreferenceKey(scenarioKey),
  );
}

export function readSelectedModelPreference(scenarioKey = "") {
  const selectedModelByScenario = loadSelectedModelByScenarioPreference();
  const normalizedScenarioKey = normalizeScenarioPreferenceKey(scenarioKey);
  return Object.prototype.hasOwnProperty.call(selectedModelByScenario, normalizedScenarioKey)
    ? normalizePreferenceString(selectedModelByScenario[normalizedScenarioKey])
    : "";
}

export function persistSelectedModelPreference(value = "", scenarioKey = "") {
  const selectedModelSelectionByScenario = loadSelectedModelSelectionByScenarioPreference();
  selectedModelSelectionByScenario[normalizeScenarioPreferenceKey(scenarioKey)] = {
    value: normalizePreferenceString(value),
    source: "user",
  };
  return writeJsonStorageValue(
    UI_PREFERENCE_STORAGE_KEYS.selectedModelSelectionByScenario,
    selectedModelSelectionByScenario,
  );
}

export function loadMemoryModelByScenarioPreference() {
  return normalizeSelectedModelByScenarioPreference(
    readJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.memoryModelByScenario, {}),
  );
}

export function readMemoryModelPreference(scenarioKey = "") {
  const memoryModelByScenario = loadMemoryModelByScenarioPreference();
  const normalizedScenarioKey = normalizeScenarioPreferenceKey(scenarioKey);
  return Object.prototype.hasOwnProperty.call(memoryModelByScenario, normalizedScenarioKey)
    ? normalizePreferenceString(memoryModelByScenario[normalizedScenarioKey])
    : "";
}

export function persistMemoryModelPreference(value = "", scenarioKey = "") {
  const memoryModelByScenario = loadMemoryModelByScenarioPreference();
  memoryModelByScenario[normalizeScenarioPreferenceKey(scenarioKey)] =
    normalizePreferenceString(value);
  return writeJsonStorageValue(
    UI_PREFERENCE_STORAGE_KEYS.memoryModelByScenario,
    memoryModelByScenario,
  );
}

function rebuildPluginPreferencesFromLegacy() {
  const scenarios = normalizePluginModelConfigByScenarioPreference(
    readJsonStorageValue(LEGACY_PLUGIN_PREFERENCE_STORAGE_KEYS.byScenario, {}),
  );
  const legacyGlobal = normalizePluginModelConfig(
    readJsonStorageValue(LEGACY_PLUGIN_PREFERENCE_STORAGE_KEYS.global, {}),
  );
  const defaultScenarioKey = normalizeScenarioPreferenceKey("");
  if (Object.keys(legacyGlobal).length && !scenarios[defaultScenarioKey]) {
    scenarios[defaultScenarioKey] = legacyGlobal;
  }
  return { version: PLUGIN_PREFERENCES_VERSION, scenarios };
}

function writePluginPreferences(preferences) {
  const written = writeJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.pluginPreferences, preferences);
  for (const legacyKey of Object.values(LEGACY_PLUGIN_PREFERENCE_STORAGE_KEYS)) {
    removeStorageValue(legacyKey);
  }
  return written;
}

export function loadPluginPreferences() {
  const stored = readJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.pluginPreferences, null);
  if (stored?.version === PLUGIN_PREFERENCES_VERSION && isPlainPreferenceObject(stored.scenarios)) {
    return {
      version: PLUGIN_PREFERENCES_VERSION,
      scenarios: normalizePluginModelConfigByScenarioPreference(stored.scenarios),
    };
  }
  const rebuilt = rebuildPluginPreferencesFromLegacy();
  writePluginPreferences(rebuilt);
  return rebuilt;
}

export function readPluginModelConfigPreference(scenarioKey = "") {
  const { scenarios } = loadPluginPreferences();
  return normalizePluginModelConfig(scenarios[normalizeScenarioPreferenceKey(scenarioKey)]);
}

export function persistPluginModelConfigPreferenceByScenario(value = {}, scenarioKey = "") {
  const preferences = loadPluginPreferences();
  preferences.scenarios[normalizeScenarioPreferenceKey(scenarioKey)] =
    normalizePluginModelConfig(value);
  return writePluginPreferences(preferences);
}

export function normalizeAvailableBotScenarios(definitions = {}) {
  const scenarioDefinitions = definitions && typeof definitions === "object" ? definitions : {};
  return Object.keys(scenarioDefinitions)
    .map((scenarioKey) => normalizePreferenceString(scenarioKey))
    .filter(Boolean)
    .map((scenarioKey) => ({
      key: scenarioKey,
      label: normalizePreferenceString(scenarioDefinitions?.[scenarioKey]?.name),
      description: normalizePreferenceString(scenarioDefinitions?.[scenarioKey]?.description),
      model: normalizePreferenceString(scenarioDefinitions?.[scenarioKey]?.model),
    }));
}

export function getAvailableScenarioKeySet(availableBotScenarios = []) {
  return new Set(
    (Array.isArray(availableBotScenarios) ? availableBotScenarios : [])
      .map((scenarioItem) => normalizePreferenceString(scenarioItem?.key))
      .filter(Boolean),
  );
}

export function resolveBotScenarioWithConfig({
  configuredDefaultScenario = "",
  currentScenario = "",
  savedScenario = readStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, ""),
  availableBotScenarios = [],
} = {}) {
  const defaultScenario = normalizePreferenceString(configuredDefaultScenario);
  const current = normalizePreferenceString(currentScenario);
  const saved = normalizePreferenceString(savedScenario);
  const availableScenarioKeySet = getAvailableScenarioKeySet(availableBotScenarios);

  if (!availableScenarioKeySet.size) {
    return { value: current || saved || defaultScenario || "", persist: false };
  }

  if (saved && availableScenarioKeySet.has(saved)) {
    return { value: saved, persist: false };
  }

  if (current && availableScenarioKeySet.has(current)) {
    return { value: current, persist: false };
  }

  return {
    value:
      (defaultScenario && availableScenarioKeySet.has(defaultScenario) ? defaultScenario : "") ||
      "",
    persist: true,
  };
}

export function syncBotScenarioWithConfig({
  configuredDefaultScenario = "",
  availableBotScenarios = [],
  preferenceRef,
} = {}) {
  const resolved = resolveBotScenarioWithConfig({
    configuredDefaultScenario,
    currentScenario: preferenceRef?.value,
    availableBotScenarios,
  });
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = resolved.value;
  }
  if (resolved.persist) persistBotScenarioPreference(resolved.value);
  return resolved;
}

export function updateBooleanPreference({ preferenceRef, key, value } = {}) {
  const nextValue = Boolean(value);
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = nextValue;
  }
  persistBooleanPreference(key, nextValue);
  return nextValue;
}

export function updateAllowUserInteractionPreference({ preferenceRef, value } = {}) {
  return updateBooleanPreference({
    preferenceRef,
    key: UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction,
    value,
  });
}

export function updateSafeConfirmPreference({ preferenceRef, value } = {}) {
  return updateBooleanPreference({
    preferenceRef,
    key: UI_PREFERENCE_STORAGE_KEYS.safeConfirm,
    value,
  });
}

export function updateSafeConfirmLevelPreference({ preferenceRef, value } = {}) {
  const nextValue = normalizeSafeConfirmLevel(value);
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef)
    preferenceRef.value = nextValue;
  writeStorageValue(UI_PREFERENCE_STORAGE_KEYS.safeConfirmLevel, nextValue);
  return nextValue;
}

export function updateSanitizeOutputPreference({ preferenceRef, value } = {}) {
  return updateBooleanPreference({
    preferenceRef,
    key: UI_PREFERENCE_STORAGE_KEYS.sanitizeOutput,
    value,
  });
}

export function updateStreamOutputPreference({ preferenceRef, value } = {}) {
  return updateBooleanPreference({
    preferenceRef,
    key: UI_PREFERENCE_STORAGE_KEYS.streamOutput,
    value,
  });
}

export function updateBotScenarioPreference({
  preferenceRef,
  value = "",
  availableBotScenarios = [],
} = {}) {
  const nextScenario = normalizePreferenceString(value);
  const availableScenarioKeySet = getAvailableScenarioKeySet(availableBotScenarios);
  const resolvedScenario =
    nextScenario && availableScenarioKeySet.has(nextScenario) ? nextScenario : "";
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = resolvedScenario;
  }
  persistBotScenarioPreference(resolvedScenario);
  return resolvedScenario;
}

export function updateSelectedModelPreference({
  preferenceRef,
  value = "",
  scenarioKey = "",
} = {}) {
  const nextModel = normalizePreferenceString(value);
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = nextModel;
  }
  persistSelectedModelPreference(nextModel, scenarioKey);
  return nextModel;
}

export function updatePluginModelConfigPreference({ preferenceRef, value = {}, scenarioKey } = {}) {
  const nextConfig = normalizePluginModelConfig(value);
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = nextConfig;
  }
  persistPluginModelConfigPreferenceByScenario(nextConfig, scenarioKey);
  return nextConfig;
}
