/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { externalFrontendPluginEntries } from "./generated/external-entries";
import { registerFrontendPlugin } from "./frontend-plugin-registry";

const REQUIRED_FRONTEND_PLUGIN_API_VERSION = "1";

function normalizeApiVersion(input = "") {
  return String(input || "").trim() || REQUIRED_FRONTEND_PLUGIN_API_VERSION;
}

export function registerExternalFrontendPlugins() {
  for (const item of externalFrontendPluginEntries) {
    const pluginId = String(item?.pluginId || "").trim();
    const pluginName = String(item?.name || pluginId).trim();
    const apiVersion = normalizeApiVersion(item?.apiVersion);
    if (apiVersion !== REQUIRED_FRONTEND_PLUGIN_API_VERSION) {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: unsupported apiVersion ${apiVersion}`,
      );
      continue;
    }
    const registerFn =
      typeof item?.module?.registerFrontendPlugin === "function"
        ? item.module.registerFrontendPlugin
        : null;
    if (typeof registerFn !== "function") {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: registerFrontendPlugin export not found`,
      );
      continue;
    }
    try {
      registerFn({
        registerFrontendPlugin,
        pluginMeta: {
          pluginId,
          pluginKey: String(item?.pluginKey || "").trim(),
          name: pluginName,
          version: String(item?.version || "").trim(),
          apiVersion,
        },
        logger: console,
      });
      console.info(`[frontend-plugin] loaded ${pluginName}`);
    } catch (error) {
      console.warn(
        `[frontend-plugin] failed to load ${pluginName}: ${String(error?.message || error)}`,
      );
    }
  }
}

