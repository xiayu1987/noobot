/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ThinkingPanel } from "noobot-chat/plugin-api/chat-ui";
import HarnessModelExtension from "./components/HarnessModelExtension.vue";
import { createThinkingDetailService } from "./services/thinkingDetailService.js";

export function matchesThinkingPanel(messageItem = {}) {
  return messageItem?.role === "assistant";
}

export const FRONTEND_PLUGIN_API_VERSION = "1";

export function registerFrontendPlugin(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const thinkingDetailService = createThinkingDetailService(ctx?.services?.authenticatedRequest?.get);
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
        component: HarnessModelExtension,
        when: (context = {}) => context?.selectedPluginKeySet?.has?.("harness") === true,
        resolveProps: (context = {}) => ({ pluginContext: context.pluginContext?.("harness") }),
  });
  contribute(points.MESSAGE_CARD_PRE, {
        id: "thinking-panel",
        capability: "message.panel.thinking",
        exclusiveGroup: "message.panel.thinking",
        slot: "pre",
        priority: 10,
        component: ThinkingPanel,
        when: (context = {}) => matchesThinkingPanel(context?.messageItem),
        resolveProps: (context = {}) => ({
          messageItem: context?.messageItem || {},
          allMessages: Array.isArray(context?.allMessages) ? context.allMessages : [],
          runtime: context?.messageRuntime || null,
          userId: String(context?.userId || ""),
          thinkingDetailService,
          renderMarkdown: context?.renderMarkdown,
          formatTime: context?.formatTime,
          formatFileSize: context?.formatFileSize,
          isImageMime: context?.isImageMime,
        }),
        resolveListeners: (context = {}) => ({
          "open-thinking-details": (payload = {}) => {
            if (typeof context?.onOpenThinkingDetails === "function") {
              context.onOpenThinkingDetails(payload);
            }
          },
        }),
  });
}
