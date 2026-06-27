export const UI_PREFERENCE_STORAGE_KEYS = Object.freeze({
  userId: "noobot_user_id",
  allowUserInteraction: "noobot_allow_user_interaction",
  forceTool: "noobot_force_tool",
  streamOutput: "noobot_stream_output",
  botScenario: "noobot_bot_scenario",
  selectedModel: "noobot_selected_model",
  selectedModelByScenario: "noobot_selected_model_by_scenario",
  selectedModelSelectionByScenario: "noobot_selected_model_selection_by_scenario_v2",
  memoryModelByScenario: "noobot_memory_model_by_scenario_v1",
  pluginModelConfig: "noobot_plugin_model_config",
  pluginModelConfigByScenario: "noobot_plugin_model_config_by_scenario_v2",
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
    if (typeof node === "string" || typeof node === "number") {
      return normalizePreferenceString(node);
    }
    if (Array.isArray(node)) {
      const nextArray = node
        .map((item) => normalizeNode(item))
        .filter((item) => {
          if (typeof item === "boolean") return true;
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

export function persistBooleanPreference(key, value) {
  return writeStorageValue(key, Boolean(value) ? "true" : "false");
}

export function loadUiPreferences() {
  const botScenario = normalizePreferenceString(readStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, ""));
  const selectedModelByScenario = loadSelectedModelByScenarioPreference();
  return {
    userId: readStorageValue(UI_PREFERENCE_STORAGE_KEYS.userId, "user-001") || "user-001",
    allowUserInteraction: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction, true),
    forceTool: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.forceTool, false),
    streamOutput: loadBooleanPreference(UI_PREFERENCE_STORAGE_KEYS.streamOutput, true),
    botScenario,
    selectedModel: readSelectedModelPreference(botScenario),
    selectedModelByScenario,
    memoryModel: readMemoryModelPreference(botScenario),
    pluginModelConfig: readPluginModelConfigPreference(botScenario),
  };
}

export function persistBotScenarioPreference(value = "") {
  return writeStorageValue(UI_PREFERENCE_STORAGE_KEYS.botScenario, normalizePreferenceString(value));
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
  memoryModelByScenario[normalizeScenarioPreferenceKey(scenarioKey)] = normalizePreferenceString(value);
  return writeJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.memoryModelByScenario, memoryModelByScenario);
}

export function persistPluginModelConfigPreference(value = {}) {
  return writeJsonStorageValue(
    UI_PREFERENCE_STORAGE_KEYS.pluginModelConfig,
    normalizePluginModelConfig(value),
  );
}

export function loadPluginModelConfigByScenarioPreference() {
  return normalizePluginModelConfigByScenarioPreference(
    readJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.pluginModelConfigByScenario, {}),
  );
}

export function hasStoredPluginModelConfigPreference(scenarioKey = "") {
  return Object.prototype.hasOwnProperty.call(
    loadPluginModelConfigByScenarioPreference(),
    normalizeScenarioPreferenceKey(scenarioKey),
  );
}

export function readLegacyPluginModelConfigPreference() {
  return normalizePluginModelConfig(
    readJsonStorageValue(UI_PREFERENCE_STORAGE_KEYS.pluginModelConfig, {}),
  );
}

export function readPluginModelConfigPreference(scenarioKey = "") {
  const pluginModelConfigByScenario = loadPluginModelConfigByScenarioPreference();
  const normalizedScenarioKey = normalizeScenarioPreferenceKey(scenarioKey);
  return Object.prototype.hasOwnProperty.call(pluginModelConfigByScenario, normalizedScenarioKey)
    ? normalizePluginModelConfig(pluginModelConfigByScenario[normalizedScenarioKey])
    : readLegacyPluginModelConfigPreference();
}

export function persistPluginModelConfigPreferenceByScenario(value = {}, scenarioKey = "") {
  const pluginModelConfigByScenario = loadPluginModelConfigByScenarioPreference();
  pluginModelConfigByScenario[normalizeScenarioPreferenceKey(scenarioKey)] = normalizePluginModelConfig(value);
  return writeJsonStorageValue(
    UI_PREFERENCE_STORAGE_KEYS.pluginModelConfigByScenario,
    pluginModelConfigByScenario,
  );
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
      defaultModel: scenarioDefinitions?.[scenarioKey]?.defaultModel,
      defaultModelAlias: normalizePreferenceString(scenarioDefinitions?.[scenarioKey]?.defaultModelAlias),
      enabledModels: Array.isArray(scenarioDefinitions?.[scenarioKey]?.enabledModels)
        ? scenarioDefinitions[scenarioKey].enabledModels
        : [],
    }));
}

function collectPluginModelValues(pluginModelConfig = {}) {
  const values = [];
  const visit = (node) => {
    if (typeof node === "string" || typeof node === "number") {
      const value = normalizePreferenceString(node);
      if (value) values.push(value);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    Object.values(node).forEach(visit);
  };
  visit(normalizePluginModelConfig(pluginModelConfig));
  return values;
}

export function normalizeModelOptionsFromEnabledModels(enabledModels = [], selectedModel = "", pluginModelConfig = {}, memoryModel = "") {
  const optionMap = new Map();
  const addOption = (rawOption = {}) => {
    const value = normalizePreferenceString(
      typeof rawOption === "string"
        ? rawOption
        : rawOption?.value || rawOption?.alias || rawOption?.key || rawOption?.model || "",
    );
    if (!value || optionMap.has(value)) return;
    const label = normalizePreferenceString(
      typeof rawOption === "string"
        ? rawOption
        : rawOption?.label || rawOption?.name || rawOption?.alias || rawOption?.model || value,
    ) || value;
    optionMap.set(value, {
      value,
      label,
      alias: normalizePreferenceString(typeof rawOption === "string" ? value : rawOption?.alias || value) || value,
      key: normalizePreferenceString(typeof rawOption === "string" ? value : rawOption?.key || rawOption?.alias || value) || value,
      name: normalizePreferenceString(typeof rawOption === "string" ? label : rawOption?.name || label) || label,
      model: normalizePreferenceString(typeof rawOption === "string" ? "" : rawOption?.model || ""),
      description: normalizePreferenceString(typeof rawOption === "string" ? "" : rawOption?.description || ""),
    });
  };
  (Array.isArray(enabledModels) ? enabledModels : []).forEach(addOption);
  addOption(selectedModel);
  addOption(memoryModel);
  collectPluginModelValues(pluginModelConfig).forEach(addOption);
  return Array.from(optionMap.values());
}

export function normalizeModelOptionsFromScenarios(availableBotScenarios = [], selectedModel = "", pluginModelConfig = {}) {
  const scenarioModels = (Array.isArray(availableBotScenarios) ? availableBotScenarios : [])
    .map((scenarioItem) => scenarioItem?.model)
    .filter(Boolean);
  return normalizeModelOptionsFromEnabledModels(scenarioModels, selectedModel, pluginModelConfig);
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

export function updateSelectedModelPreference({ preferenceRef, value = "", scenarioKey = "" } = {}) {
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
  if (typeof scenarioKey === "undefined") persistPluginModelConfigPreference(nextConfig);
  else persistPluginModelConfigPreferenceByScenario(nextConfig, scenarioKey);
  return nextConfig;
}
