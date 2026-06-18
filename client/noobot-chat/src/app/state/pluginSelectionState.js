export const SELECTED_PLUGINS_STORAGE_KEY = "noobot_selected_plugins";
export const DEFAULT_ON_PLUGINS_STORAGE_KEY = "noobot_default_on_plugins";

export function safeParseStringArray(rawValue = "") {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"));
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function hasStoredSelectedPluginKeys() {
  return localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY) !== null;
}

export function loadSelectedPluginKeys() {
  return safeParseStringArray(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY));
}

export function normalizeAvailablePlugins(pluginDefinitions = {}) {
  const definitions = pluginDefinitions && typeof pluginDefinitions === "object" ? pluginDefinitions : {};
  return Object.entries(definitions)
    .map(([pluginKey, pluginDefinition]) => {
      const source = pluginDefinition && typeof pluginDefinition === "object" ? pluginDefinition : {};
      return {
        key: String(pluginKey || "").trim(),
        label: String(source?.label || source?.name || pluginKey || "").trim(),
        description: String(source?.description || "").trim(),
        enabled: source?.enabled === true,
        mode: String(source?.mode || "")
          .trim()
          .toLowerCase() === "on"
          ? "on"
          : "off",
      };
    })
    .filter((pluginItem) => Boolean(pluginItem.key) && pluginItem.enabled === true);
}

export function getDefaultOnPluginKeys(pluginOptions = []) {
  return (Array.isArray(pluginOptions) ? pluginOptions : [])
    .filter(
      (pluginItem) =>
        pluginItem?.enabled === true &&
        String(pluginItem?.mode || "").toLowerCase() === "on",
    )
    .map((pluginItem) => String(pluginItem?.key || "").trim())
    .filter(Boolean);
}

export function persistDefaultOnPluginKeys(pluginKeys = []) {
  const normalizedPluginKeys = (Array.isArray(pluginKeys) ? pluginKeys : [])
    .map((pluginKey) => String(pluginKey || "").trim())
    .filter(Boolean);
  localStorage.setItem(
    DEFAULT_ON_PLUGINS_STORAGE_KEY,
    JSON.stringify(Array.from(new Set(normalizedPluginKeys))),
  );
}

export function persistSelectedPlugins({ selectedPlugins, hasStoredSelectedPlugins } = {}) {
  if (hasStoredSelectedPlugins) hasStoredSelectedPlugins.value = true;
  localStorage.setItem(SELECTED_PLUGINS_STORAGE_KEY, JSON.stringify(selectedPlugins?.value));
}

export function syncSelectedPluginsWithConfig({
  pluginOptions = [],
  selectedPlugins,
  hasStoredSelectedPlugins,
} = {}) {
  const normalizedPluginOptions = Array.isArray(pluginOptions) ? pluginOptions : [];
  if (!normalizedPluginOptions.length) {
    // 连接前 scenarioConfig 为空，避免把本地已选插件误清空并持久化。
    return;
  }
  const availablePluginKeySet = new Set(normalizedPluginOptions.map((item) => item.key));
  const enabledPluginKeySet = new Set(
    normalizedPluginOptions.filter((item) => item.enabled === true).map((item) => item.key),
  );
  const defaultOnPluginKeys = getDefaultOnPluginKeys(normalizedPluginOptions);
  const previousDefaultOnPluginKeySet = new Set(
    safeParseStringArray(localStorage.getItem(DEFAULT_ON_PLUGINS_STORAGE_KEY)),
  );
  if (!hasStoredSelectedPlugins?.value) {
    selectedPlugins.value = defaultOnPluginKeys;
    persistDefaultOnPluginKeys(defaultOnPluginKeys);
    return;
  }
  const selectedPluginKeySet = new Set(
    selectedPlugins.value.filter((pluginKey) =>
      availablePluginKeySet.has(pluginKey) && enabledPluginKeySet.has(pluginKey),
    ),
  );
  // 配置从“非工作流/插件 off”切回“插件 mode=on”时，本地已持久化的 []
  // 不应永久压过新的后端默认开启配置；只补齐“本次配置新增为默认开启”的插件。
  for (const pluginKey of defaultOnPluginKeys) {
    if (!previousDefaultOnPluginKeySet.has(pluginKey)) {
      selectedPluginKeySet.add(pluginKey);
    }
  }
  selectedPlugins.value = Array.from(selectedPluginKeySet);
  persistDefaultOnPluginKeys(defaultOnPluginKeys);
  persistSelectedPlugins({ selectedPlugins, hasStoredSelectedPlugins });
}
