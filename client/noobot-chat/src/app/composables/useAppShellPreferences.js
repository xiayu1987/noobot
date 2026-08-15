/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref, watch } from "vue";
import {
  hasStoredSelectedPluginKeys,
  loadSelectedPluginKeys,
  normalizeAvailablePlugins,
  persistSelectedPlugins as persistSelectedPluginsState,
  syncSelectedPluginsWithConfig as syncSelectedPluginsWithConfigState,
} from "../state/pluginSelectionState.js";
import {
  hasStoredSelectedModelPreference,
  loadUiPreferences,
  normalizeAvailableBotScenarios,
  normalizeModelOptionsFromEnabledModels,
  readPluginModelConfigPreference,
  readMemoryModelPreference,
  readSelectedModelPreference,
  syncBotScenarioWithConfig as syncBotScenarioWithConfigState,
  updateAllowUserInteractionPreference,
  updateBotScenarioPreference,
  updateSafeConfirmPreference,
  updateSafeConfirmLevelPreference,
  updateSanitizeOutputPreference,
  updatePluginModelConfigPreference,
  persistMemoryModelPreference,
  updateSelectedModelPreference,
  updateStreamOutputPreference,
  applyFrontendPluginModelConfigDefaults,
} from "../storage/uiPreferencesStorage.js";

function resolveModelValue(value) {
  return String(value || "").trim();
}

function resolveDefaultSelectedModelFromConfig(config = {}, scenarioKey = "") {
  const defaultModel = config?.defaultModel;
  const currentScenarioKey = resolveModelValue(scenarioKey);
  const scenarioDefinition = currentScenarioKey && config?.definitions && typeof config.definitions === "object"
    ? config.definitions[currentScenarioKey] || {}
    : {};
  const scenarioDefaultModel = scenarioDefinition?.defaultModel;
  const candidates = [
    scenarioDefinition?.defaultModelAlias,
    typeof scenarioDefaultModel === "string" ? scenarioDefaultModel : "",
    scenarioDefaultModel?.value,
    scenarioDefaultModel?.alias,
    scenarioDefaultModel?.key,
    scenarioDefaultModel?.model,
    scenarioDefinition?.model,
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.value : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.alias : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.key : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.model : "",
    config?.defaultModelAlias,
    typeof defaultModel === "string" ? defaultModel : "",
    defaultModel?.value,
    defaultModel?.alias,
    defaultModel?.key,
    defaultModel?.model,
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.value : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.alias : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.key : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.model : "",
  ];
  return candidates.map(resolveModelValue).find(Boolean) || "";
}

export function useAppShellPreferences({ scenarioConfig } = {}) {
  const scenarioConfigRef = ref(scenarioConfig || null);
  const currentScenarioConfig = computed(() => scenarioConfigRef.value?.value || {});
  const uiPreferences = loadUiPreferences();
  const userId = ref(uiPreferences.userId);
  const allowUserInteraction = ref(uiPreferences.allowUserInteraction);
  const safeConfirm = ref(uiPreferences.safeConfirm);
  const safeConfirmLevel = ref(uiPreferences.safeConfirmLevel);
  const sanitizeOutput = ref(uiPreferences.sanitizeOutput);
  const streamOutput = ref(uiPreferences.streamOutput);
  const botScenario = ref(uiPreferences.botScenario);
  const selectedModel = ref(uiPreferences.selectedModel);
  const memoryModel = ref(uiPreferences.memoryModel);
  const pluginModelConfig = ref(
    applyFrontendPluginModelConfigDefaults(uiPreferences.pluginModelConfig),
  );
  const frontendThresholdsEnabled = ref(false);
  const summaryPolicy = ref({});
  const hasStoredSelectedPlugins = ref(hasStoredSelectedPluginKeys(userId.value));
  const selectedPlugins = ref(loadSelectedPluginKeys(userId.value));

  const availableBotScenarios = computed(() => normalizeAvailableBotScenarios(
    currentScenarioConfig.value?.definitions,
  ));

  const activeScenarioDefinition = computed(() => {
    const scenarioKey = String(botScenario.value || "").trim();
    const definitions = currentScenarioConfig.value?.definitions;
    return scenarioKey && definitions && typeof definitions === "object"
      ? definitions[scenarioKey] || {}
      : {};
  });

  const availableModelOptions = computed(() => normalizeModelOptionsFromEnabledModels(
    Array.isArray(activeScenarioDefinition.value?.enabledModels) && activeScenarioDefinition.value.enabledModels.length
      ? activeScenarioDefinition.value.enabledModels
      : currentScenarioConfig.value?.enabledModels || [],
    selectedModel.value,
    pluginModelConfig.value,
    memoryModel.value,
  ));

  const availablePlugins = computed(() => {
    const definitions =
      currentScenarioConfig.value?.plugins && typeof currentScenarioConfig.value.plugins === "object"
        ? currentScenarioConfig.value.plugins
        : {};
    return normalizeAvailablePlugins(definitions);
  });

  function persistSelectedPlugins() {
    persistSelectedPluginsState({
      userId: userId.value,
      selectedPlugins,
      hasStoredSelectedPlugins,
    });
  }

  function syncSelectedPluginsWithConfig() {
    syncSelectedPluginsWithConfigState({
      pluginOptions: availablePlugins.value,
      selectedPlugins,
      hasStoredSelectedPlugins,
      userId: userId.value,
    });
  }

  function syncBotScenarioWithConfig() {
    syncBotScenarioWithConfigState({
      configuredDefaultScenario: currentScenarioConfig.value?.default,
      availableBotScenarios: availableBotScenarios.value,
      preferenceRef: botScenario,
    });
  }

  function syncSelectedModelWithConfig() {
    const currentScenarioKey = String(botScenario.value || "").trim();
    if (hasStoredSelectedModelPreference(currentScenarioKey)) {
      selectedModel.value = readSelectedModelPreference(currentScenarioKey);
      return;
    }
    selectedModel.value = resolveDefaultSelectedModelFromConfig(
      currentScenarioConfig.value || {},
      currentScenarioKey,
    );
  }

  function syncPluginModelConfigWithPreference() {
    const currentScenarioKey = String(botScenario.value || "").trim();
    pluginModelConfig.value = applyFrontendPluginModelConfigDefaults(
      readPluginModelConfigPreference(currentScenarioKey),
    );
    memoryModel.value = readMemoryModelPreference(currentScenarioKey);
  }

  function onAllowUserInteractionUpdate(value) {
    updateAllowUserInteractionPreference({ preferenceRef: allowUserInteraction, value });
  }

  function onSafeConfirmUpdate(value) {
    updateSafeConfirmPreference({ preferenceRef: safeConfirm, value });
  }

  function onSafeConfirmLevelUpdate(value) {
    updateSafeConfirmLevelPreference({ preferenceRef: safeConfirmLevel, value });
  }

  function onSanitizeOutputUpdate(value) {
    updateSanitizeOutputPreference({ preferenceRef: sanitizeOutput, value });
  }

  function onStreamOutputUpdate(value) {
    updateStreamOutputPreference({ preferenceRef: streamOutput, value });
  }

  function onBotScenarioUpdate(value = "") {
    updateBotScenarioPreference({
      preferenceRef: botScenario,
      value,
      availableBotScenarios: availableBotScenarios.value,
    });
  }

  function onSelectedModelUpdate(value = "") {
    updateSelectedModelPreference({ preferenceRef: selectedModel, value, scenarioKey: botScenario.value });
  }

  function onMemoryModelUpdate(value = "") {
    memoryModel.value = String(value || "").trim();
    persistMemoryModelPreference(memoryModel.value, botScenario.value);
  }

  function onPluginModelConfigUpdate(value = {}) {
    updatePluginModelConfigPreference({ preferenceRef: pluginModelConfig, value, scenarioKey: botScenario.value });
  }

  function onSummaryPolicyUpdate(value = {}) {
    summaryPolicy.value = value && typeof value === "object" && !Array.isArray(value)
      ? { ...value }
      : {};
  }

  function onFrontendThresholdsEnabledUpdate(value = false) {
    frontendThresholdsEnabled.value = value === true;
  }

  function onSelectedPluginsUpdate(value = []) {
    const selectablePluginKeySet = new Set(
      availablePlugins.value
        .filter((pluginItem) => pluginItem?.enabled === true)
        .map((pluginItem) => String(pluginItem?.key || "").trim())
        .filter(Boolean),
    );
    selectedPlugins.value = (Array.isArray(value) ? value : [])
      .map((pluginKey) => String(pluginKey || "").trim())
      .filter((pluginKey) => pluginKey && selectablePluginKeySet.has(pluginKey));
    persistSelectedPlugins();
  }

  function onUserIdUpdate(value = "") {
    const nextUserId = String(value || "").trim();
    if (nextUserId === userId.value) return;
    userId.value = nextUserId;
    hasStoredSelectedPlugins.value = hasStoredSelectedPluginKeys(nextUserId);
    selectedPlugins.value = loadSelectedPluginKeys(nextUserId);
    syncSelectedPluginsWithConfig();
  }

  function bindScenarioConfig(nextScenarioConfig) {
    scenarioConfigRef.value = nextScenarioConfig || null;
  }

  watch(
    () => currentScenarioConfig.value,
    () => {
      syncBotScenarioWithConfig();
      syncSelectedPluginsWithConfig();
      syncSelectedModelWithConfig();
      syncPluginModelConfigWithPreference();
    },
    { deep: true, immediate: true },
  );

  watch(
    () => botScenario.value,
    () => {
      syncSelectedModelWithConfig();
      syncPluginModelConfigWithPreference();
    },
  );

  return {
    userId,
    allowUserInteraction,
    safeConfirm,
    safeConfirmLevel,
    sanitizeOutput,
    streamOutput,
    botScenario,
    selectedModel,
    memoryModel,
    pluginModelConfig,
    frontendThresholdsEnabled,
    summaryPolicy,
    selectedPlugins,
    availableBotScenarios,
    availableModelOptions,
    availablePlugins,
    bindScenarioConfig,
    onAllowUserInteractionUpdate,
    onSafeConfirmUpdate,
    onSafeConfirmLevelUpdate,
    onSanitizeOutputUpdate,
    onStreamOutputUpdate,
    onBotScenarioUpdate,
    onSelectedModelUpdate,
    onMemoryModelUpdate,
    onPluginModelConfigUpdate,
    onFrontendThresholdsEnabledUpdate,
    onSummaryPolicyUpdate,
    onSelectedPluginsUpdate,
    onUserIdUpdate,
  };
}
