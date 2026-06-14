import { computed } from "vue";

const CONNECTOR_KEYS = ["database", "terminal", "email"];

export function useComposerOptions(props, emit, translate) {
  const selectedConnectorNames = computed(() => {
    const selectedSource =
      props?.connectorPanelState?.selectedConnectors &&
      typeof props.connectorPanelState.selectedConnectors === "object"
        ? props.connectorPanelState.selectedConnectors
        : {};
    return CONNECTOR_KEYS.map((key) => String(selectedSource?.[key] || "").trim()).filter(Boolean);
  });

  const attachmentCount = computed(() => (props.uploadFiles || []).length);

  const normalizedScenarioOptions = computed(() => {
    const sourceOptions = Array.isArray(props.scenarioOptions) ? props.scenarioOptions : [];
    return sourceOptions
      .map((scenarioItem) => ({
        key: String(scenarioItem?.key || "").trim(),
        label: String(scenarioItem?.label || "").trim(),
        description: String(scenarioItem?.description || "").trim(),
      }))
      .filter((scenarioItem) => Boolean(scenarioItem.key));
  });

  function resolveScenarioLabel(scenarioItem = {}) {
    const scenarioKey = String(scenarioItem?.key || "").trim().toLowerCase();
    const customLabel = String(scenarioItem?.label || "").trim();
    if (customLabel) return customLabel;
    if (scenarioKey === "programming") return translate("composer.scenarioProgramming");
    if (scenarioKey === "full") return translate("composer.scenarioFull");
    return String(scenarioItem?.key || "").trim();
  }

  const selectedScenarioLabel = computed(() => {
    const currentScenario = String(props.botScenario || "").trim();
    if (!currentScenario) return "";
    const matchedScenario = normalizedScenarioOptions.value.find(
      (scenarioItem) => scenarioItem.key === currentScenario,
    );
    if (matchedScenario) return resolveScenarioLabel(matchedScenario);
    if (currentScenario.toLowerCase() === "programming") return translate("composer.scenarioProgramming");
    return currentScenario;
  });

  const selectedScenarioDescription = computed(() => {
    const currentScenario = String(props.botScenario || "").trim();
    if (!currentScenario) return "";
    const matchedScenario = normalizedScenarioOptions.value.find(
      (scenarioItem) => scenarioItem.key === currentScenario,
    );
    return String(matchedScenario?.description || "").trim();
  });

  const normalizedPluginOptions = computed(() => {
    const sourcePlugins = Array.isArray(props.availablePlugins) ? props.availablePlugins : [];
    return sourcePlugins
      .map((pluginItem) => ({
        key: String(pluginItem?.key || pluginItem?.name || "").trim(),
        label: String(pluginItem?.label || pluginItem?.name || pluginItem?.key || "").trim(),
        description: String(pluginItem?.description || "").trim(),
        enabled: pluginItem?.enabled === true,
        mode: String(pluginItem?.mode || "").trim().toLowerCase() === "on" ? "on" : "off",
      }))
      .filter((pluginItem) => Boolean(pluginItem.key));
  });

  const selectedPluginKeySet = computed(
    () =>
      new Set(
        (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
          .map((pluginKey) => String(pluginKey || "").trim())
          .filter(Boolean),
      ),
  );

  const selectedPluginLabels = computed(() =>
    normalizedPluginOptions.value
      .filter((pluginItem) => selectedPluginKeySet.value.has(pluginItem.key))
      .map((pluginItem) => pluginItem.label || pluginItem.key),
  );

  function onSelectedPluginsChange(pluginKeys = []) {
    emit(
      "update:selectedPlugins",
      (Array.isArray(pluginKeys) ? pluginKeys : [])
        .map((pluginKey) => String(pluginKey || "").trim())
        .filter(Boolean),
    );
  }

  function onPluginToggle(pluginKey = "") {
    const key = String(pluginKey || "").trim();
    if (!key) return;
    const current = new Set(
      (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (current.has(key)) current.delete(key);
    else current.add(key);
    onSelectedPluginsChange(Array.from(current));
  }

  function onProgrammingScenarioToggle() {
    const currentScenario = String(props.botScenario || "").trim();
    emit("update:botScenario", currentScenario === "programming" ? "" : "programming");
  }

  function onScenarioSelect(scenarioKey = "") {
    const normalizedScenarioKey = String(scenarioKey || "").trim();
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
