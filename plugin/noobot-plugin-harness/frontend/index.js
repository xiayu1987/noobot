/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { useHarnessLocale } from "./i18n/index.js";

const GUIDANCE_ANALYSIS_ACTIVITY_KIND = "guidance_analysis";

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
  const { translate } = useHarnessLocale();
  contribute(points.THINKING_CONTENT_ITEM, {
    id: "harness-guidance-analysis",
    provide: () => [
      {
        activityKind: GUIDANCE_ANALYSIS_ACTIVITY_KIND,
        label: () => translate("thinkingSection.guidanceAnalysis"),
      },
    ],
  });
  return createPluginActivationResult({ pluginId: "harness", surface: PLUGIN_SURFACE.FRONTEND });
}
