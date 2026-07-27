/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createPluginContext({ pluginId = "", getConfig, updateConfig } = {}) {
  const namespace = String(pluginId || "").trim();
  if (!namespace) throw new Error("plugin context id is required");
  return Object.freeze({
    pluginId: namespace,
    config: Object.freeze({
      get() {
        const root = typeof getConfig === "function" ? getConfig() : {};
        const value = root?.[namespace];
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      },
      patch(patch = {}) {
        if (typeof updateConfig !== "function") return;
        const root = typeof getConfig === "function" ? getConfig() : {};
        const current = root?.[namespace] && typeof root[namespace] === "object" ? root[namespace] : {};
        updateConfig({ ...root, [namespace]: { ...current, ...(patch && typeof patch === "object" ? patch : {}) } });
      },
    }),
  });
}
