/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";

export async function activate(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  if (typeof contribute !== "function" || !points) {
    throw new Error("frontend contribution API is required");
  }
  contribute(points.MARKDOWN_COLLAPSE_MARKERS, {
    id: "harness-legacy-collapse-marker",
    provide: () => ["NOOBOT_HARNESS_COLLAPSE"],
  });
  contribute(points.COMPOSER_OPTIONS_MODEL, {
    id: "harness-model-extension",
    capability: "composer.model-extension",
    priority: 10,
    when: (context = {}) => context?.selectedPluginKeySet?.has?.("harness") === true,
    resolveProps: (context = {}) => ({ pluginContext: context.pluginContext?.("harness") }),
  });
  contribute(points.THINKING_PANEL_SECTION, {
    id: "harness-guidance-analysis",
    capability: "thinking.section.guidance-analysis",
    priority: 10,
    when: (context = {}) => Boolean(context?.latestGuidanceAnalysis),
    resolveProps: (context = {}) => ({
      latestGuidanceAnalysis: context?.latestGuidanceAnalysis || null,
    }),
  });
  return createPluginActivationResult({ pluginId: "harness", surface: PLUGIN_SURFACE.FRONTEND });
}
