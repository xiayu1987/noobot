/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const SELECTED_PLUGINS_STORAGE_KEY = "noobot_selected_plugins";

export function selectedPluginsStorageKey(userId = "") {
  const owner = String(userId || "").trim();
  return owner ? `${SELECTED_PLUGINS_STORAGE_KEY}:${encodeURIComponent(owner)}` : "";
}

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

export function hasStoredSelectedPluginKeys(userId = "") {
  const storageKey = selectedPluginsStorageKey(userId);
  return Boolean(storageKey) && localStorage.getItem(storageKey) !== null;
}

export function loadSelectedPluginKeys(userId = "") {
  const storageKey = selectedPluginsStorageKey(userId);
  return storageKey ? safeParseStringArray(localStorage.getItem(storageKey)) : [];
}

export function normalizeAvailablePlugins(pluginDefinitions = {}) {
  const definitions =
    pluginDefinitions && typeof pluginDefinitions === "object" ? pluginDefinitions : {};
  return Object.entries(definitions)
    .map(([pluginKey, pluginDefinition]) => {
      const source =
        pluginDefinition && typeof pluginDefinition === "object" ? pluginDefinition : {};
      return {
        key: String(pluginKey || "").trim(),
        label: String(source?.label || source?.name || pluginKey || "").trim(),
        description: String(source?.description || "").trim(),
        enabled: source?.enabled === true,
        selectedByDefault:
          String(source?.mode || "")
            .trim()
            .toLowerCase() === "on",
      };
    })
    .filter((pluginItem) => Boolean(pluginItem.key) && pluginItem.enabled === true);
}

export function persistSelectedPlugins({
  userId = "",
  selectedPlugins,
  hasStoredSelectedPlugins,
} = {}) {
  const storageKey = selectedPluginsStorageKey(userId);
  if (!storageKey) return;
  if (hasStoredSelectedPlugins) hasStoredSelectedPlugins.value = true;
  localStorage.setItem(storageKey, JSON.stringify(selectedPlugins?.value));
}

export function syncSelectedPluginsWithConfig({
  pluginOptions = [],
  selectedPlugins,
  hasStoredSelectedPlugins,
  userId = "",
} = {}) {
  const normalizedPluginOptions = Array.isArray(pluginOptions) ? pluginOptions : [];
  if (!normalizedPluginOptions.length) {
    return;
  }
  const availablePluginKeySet = new Set(normalizedPluginOptions.map((item) => item.key));
  const enabledPluginKeySet = new Set(
    normalizedPluginOptions.filter((item) => item.enabled === true).map((item) => item.key),
  );
  if (!hasStoredSelectedPlugins?.value) {
    selectedPlugins.value = normalizedPluginOptions
      .filter((pluginItem) => pluginItem.enabled === true && pluginItem.selectedByDefault === true)
      .map((pluginItem) => pluginItem.key);
    persistSelectedPlugins({ userId, selectedPlugins, hasStoredSelectedPlugins });
    return;
  }
  const selectedPluginKeySet = new Set(
    selectedPlugins.value.filter(
      (pluginKey) => availablePluginKeySet.has(pluginKey) && enabledPluginKeySet.has(pluginKey),
    ),
  );
  selectedPlugins.value = Array.from(selectedPluginKeySet);
  persistSelectedPlugins({ userId, selectedPlugins, hasStoredSelectedPlugins });
}
