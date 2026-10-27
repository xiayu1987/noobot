/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { text } from "@noobot/shared/value";

export function useComposerOptions(props, emit, translate) {
  const selectedConnectorNames = computed(() => {
    const panelState = props.connectorPanelState;
    if (panelState === null) return [];
    const selectedIds = new Set(panelState.selectedConnectorIds);
    return panelState.connectors
      .filter((item) => selectedIds.has(item.connectorId))
      .map((item) => item.name);
  });

  const attachmentCount = computed(() => (props.uploadFiles || []).length);

  const normalizedScenarioOptions = computed(() => {
    const sourceOptions = Array.isArray(props.scenarioOptions) ? props.scenarioOptions : [];
    return sourceOptions
      .map((scenarioItem) => ({
        key: text(scenarioItem?.key),
        label: text(scenarioItem?.label),
        description: text(scenarioItem?.description),
        model: text(scenarioItem?.model),
      }))
      .filter((scenarioItem) => Boolean(scenarioItem.key));
  });

  function resolveScenarioLabel(scenarioItem = {}) {
    const scenarioKey = text(scenarioItem?.key).toLowerCase();
    const customLabel = text(scenarioItem?.label);
    if (customLabel) return customLabel;
    if (scenarioKey === "programming") return translate("composer.scenarioProgramming");
    if (scenarioKey === "text") return translate("composer.scenarioText");
    if (scenarioKey === "full") return translate("composer.scenarioFull");
    return text(scenarioItem?.key);
  }

  const selectedScenarioLabel = computed(() => {
    const currentScenario = text(props.botScenario);
    if (!currentScenario) return "";
    const matchedScenario = normalizedScenarioOptions.value.find(
      (scenarioItem) => scenarioItem.key === currentScenario,
    );
    if (matchedScenario) return resolveScenarioLabel(matchedScenario);
    if (currentScenario.toLowerCase() === "programming")
      return translate("composer.scenarioProgramming");
    if (currentScenario.toLowerCase() === "text") return translate("composer.scenarioText");
    return currentScenario;
  });

  const selectedScenarioDescription = computed(() => {
    const currentScenario = text(props.botScenario);
    if (!currentScenario) return "";
    const matchedScenario = normalizedScenarioOptions.value.find(
      (scenarioItem) => scenarioItem.key === currentScenario,
    );
    return text(matchedScenario?.description);
  });

  const normalizedPluginOptions = computed(() => {
    const sourcePlugins = Array.isArray(props.availablePlugins) ? props.availablePlugins : [];
    return sourcePlugins
      .map((pluginItem) => ({
        key: text(pluginItem?.key),
        description: text(pluginItem?.description),
        enabled: pluginItem?.enabled === true,
      }))
      .filter((pluginItem) => Boolean(pluginItem.key));
  });

  const selectedPluginKeySet = computed(
    () =>
      new Set(
        (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
          .map((pluginKey) => text(pluginKey))
          .filter(Boolean),
      ),
  );

  const selectedPluginLabels = computed(() =>
    normalizedPluginOptions.value
      .filter((pluginItem) => selectedPluginKeySet.value.has(pluginItem.key))
      .map((pluginItem) => pluginItem.key),
  );

  function onSelectedPluginsChange(pluginKeys = []) {
    emit(
      "update:selectedPlugins",
      (Array.isArray(pluginKeys) ? pluginKeys : [])
        .map((pluginKey) => text(pluginKey))
        .filter(Boolean),
    );
  }

  function onPluginToggle(pluginKey = "") {
    const key = text(pluginKey);
    if (!key) return;
    const current = new Set(
      (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
        .map((item) => text(item))
        .filter(Boolean),
    );
    if (current.has(key)) current.delete(key);
    else current.add(key);
    onSelectedPluginsChange(Array.from(current));
  }

  function onProgrammingScenarioToggle() {
    const currentScenario = text(props.botScenario);
    emit("update:botScenario", currentScenario === "programming" ? "" : "programming");
  }

  function onScenarioSelect(scenarioKey = "") {
    const normalizedScenarioKey = text(scenarioKey);
    if (!normalizedScenarioKey) return;
    emit("update:botScenario", normalizedScenarioKey);
  }

  return {
    selectedConnectorNames,
    attachmentCount,
    normalizedScenarioOptions,
    selectedScenarioLabel,
    selectedScenarioDescription,
    normalizedPluginOptions,
    selectedPluginKeySet,
    selectedPluginLabels,
    resolveScenarioLabel,
    onPluginToggle,
    onProgrammingScenarioToggle,
    onScenarioSelect,
  };
}
