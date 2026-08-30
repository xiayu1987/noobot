/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { createCharacterAssetRouteHandlers } from "../service/asset-routes.js";

export function activate(host = {}) {
  const handlers = createCharacterAssetRouteHandlers({
    workspaceAssets: host?.ports?.workspaceAssets,
  });
  for (const [routeId, handler] of Object.entries(handlers)) host?.routes?.bind(routeId, handler);
  return createPluginActivationResult({ pluginId: "character", surface: PLUGIN_SURFACE.SERVICE });
}
