/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const externalFrontendPluginEntries = [
  {
    pluginId: "harness",
    pluginKey: "harness",
    name: "noobot-plugin-harness",
    version: "4.1.4",
    apiVersion: "1",
    authenticatedRoutePatterns: ["/api/internal/session/:userId/:sessionId/thinking-detail"],
    loadModule: () => import("../../../../../plugin/noobot-plugin-harness/frontend/index.js"),
  },
  {
    pluginId: "workflow",
    pluginKey: "workflow",
    name: "noobot-plugin-workflow",
    version: "4.1.4",
    apiVersion: "1",
    authenticatedRoutePatterns: ["/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId","/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId/thinking-detail"],
    loadModule: () => import("../../../../../plugin/noobot-plugin-workflow/frontend/index.js"),
  }
];
