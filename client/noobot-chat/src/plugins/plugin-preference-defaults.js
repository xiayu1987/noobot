/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { externalFrontendPluginEntries } from "./generated/external-entries.js";

export function resolvePluginPreferenceDefaults(entries = externalFrontendPluginEntries) {
  const defaultsByPluginId = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const pluginId = String(entry?.pluginId || "").trim();
    const preferences = entry?.manifest?.configuration?.preferences;
    if (!pluginId || !preferences || typeof preferences !== "object") continue;
    defaultsByPluginId[pluginId] = preferences;
  }
  return Object.freeze(defaultsByPluginId);
}
