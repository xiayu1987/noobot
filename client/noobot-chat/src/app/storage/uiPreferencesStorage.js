export const UI_PREFERENCE_STORAGE_KEYS = Object.freeze({
  userId: "noobot_user_id",
  allowUserInteraction: "noobot_allow_user_interaction",
  forceTool: "noobot_force_tool",
  streamOutput: "noobot_stream_output",
  botScenario: "noobot_bot_scenario",
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

export function normalizePreferenceString(value = "") {
  return String(value || "").trim();
}

export function loadBooleanPreference(key, defaultValue = true) {
  const storedValue = readStorageValue(key, null);
  if (defaultValue) return storedValue !== "false";
  return storedValue === "true";
}

export function persistBooleanPreference(key, value) {
  return writeStorageValue(key, Boolean(value) ? "true" : "false");
}

export function loadUiPreferences() {
  return {
    userId: readStorageValue(UI_PREFERENCE_STORAGE_KEYS.userId, "user-001") || "user-001",
    allowUserInteraction: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction, true),
    forceTool: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.forceTool, false),
    streamOutput: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.streamOutput, true),
    botScenario: normalizePreferenceString(readStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, "")),
  };
}

export function persistBotScenarioPreference(value = "") {
  return writeStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, normalizePreferenceString(value));
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
    value: (defaultScenario && availableScenarioKeySet.has(defaultScenario) ? defaultScenario : "") || "",
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

export function updateForceToolPreference({ preferenceRef, value } = {}) {
  return updateBooleanPreference({
    preferenceRef,
    key: UI_PREFERENCE_STORAGE_KEYS.forceTool,
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
  const resolvedScenario = nextScenario && availableScenarioKeySet.has(nextScenario) ? nextScenario : "";
  if (preferenceRef && typeof preferenceRef === "object" && "value" in preferenceRef) {
    preferenceRef.value = resolvedScenario;
  }
  persistBotScenarioPreference(resolvedScenario);
  return resolvedScenario;
}
