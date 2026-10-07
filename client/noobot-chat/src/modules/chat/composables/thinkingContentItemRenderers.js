/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { THINKING_DETAIL_CONTENT_KIND } from "@noobot/event-protocol/thinking-detail-content";
import {
  extensionRegistryRevision,
  provideExtensionValues,
} from "../../../extensions/extension-registry.js";

function normalizeRenderer(value = {}) {
  const activityKind = String(value?.activityKind || "").trim();
  if (!activityKind || typeof value?.label !== "function") return null;
  return [activityKind, Object.freeze({ activityKind, label: value.label })];
}

export function useThinkingContentItemRenderers() {
  const renderers = computed(() => {
    void extensionRegistryRevision.value;
    return new Map(
      provideExtensionValues(EXTENSION_POINTS.THINKING_CONTENT_ITEM)
        .map(normalizeRenderer)
        .filter(Boolean),
    );
  });
  function rendererFor(item = {}) {
    return renderers.value.get(String(item?.activityKind || "").trim()) || null;
  }
  function isRenderable(item = {}) {
    if (item?.contentKind !== THINKING_DETAIL_CONTENT_KIND.PLUGIN_ACTIVITY) return true;
    return Boolean(rendererFor(item));
  }
  return { renderers, rendererFor, isRenderable };
}
