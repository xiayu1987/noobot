/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import WorkflowMessageCard from "./components/WorkflowMessageCard.vue";

export const FRONTEND_PLUGIN_API_VERSION = "1";

export function registerFrontendPlugin(ctx = {}) {
  const register = ctx?.registerFrontendPlugin;
  if (typeof register !== "function") {
    throw new Error("frontend register API is required");
  }
  register({
    id: "workflow",
    name: "workflow-message-card",
    capabilities: ["message.card.workflow"],
    messageCards: [
      {
        id: "workflow-card",
        capability: "message.card.workflow",
        slot: "pre",
        priority: 100,
        component: WorkflowMessageCard,
        match: (messageItem = {}) => messageItem?.workflowMessage === true,
        resolveProps: (context = {}) => ({
          messageItem: context?.messageItem || {},
          userId: String(context?.userId || ""),
          authFetch: typeof context?.authFetch === "function" ? context.authFetch : null,
          renderMarkdown: context?.renderMarkdown,
          formatTime: context?.formatTime,
          formatFileSize: context?.formatFileSize,
          isImageMime: context?.isImageMime,
        }),
      },
    ],
  });
}
