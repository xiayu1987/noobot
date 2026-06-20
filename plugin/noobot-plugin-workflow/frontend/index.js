/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import WorkflowMessageCard from "./components/WorkflowMessageCard.vue";
import WorkflowModelExtension from "./components/WorkflowModelExtension.vue";

export const FRONTEND_PLUGIN_API_VERSION = "1";

function isWorkflowMessageLike(messageItem = {}) {
  const type = String(messageItem?.type || "").trim().toLowerCase();
  const pluginMeta =
    messageItem?.pluginMeta &&
    typeof messageItem.pluginMeta === "object" &&
    !Array.isArray(messageItem.pluginMeta)
      ? messageItem.pluginMeta
      : null;
  const source = String(pluginMeta?.source || "").trim().toLowerCase();
  const kind = String(pluginMeta?.kind || "").trim().toLowerCase();
  const phase = String(pluginMeta?.phase || "").trim().toLowerCase();
  return type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase);
}

export function registerFrontendPlugin(ctx = {}) {
  const register = ctx?.registerFrontendPlugin;
  if (typeof register !== "function") {
    throw new Error("frontend register API is required");
  }
  register({
    id: "workflow",
    name: "workflow-frontend",
    capabilities: ["message.card.workflow"],
    composerModelExtensions: [
      {
        id: "workflow-model-extension",
        capability: "composer.model-extension",
        priority: 20,
        component: WorkflowModelExtension,
      },
    ],
    messageCards: [
      {
        id: "workflow-card",
        capability: "message.card.workflow",
        slot: "pre",
        priority: 100,
        component: WorkflowMessageCard,
        match: (messageItem = {}) => isWorkflowMessageLike(messageItem),
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
