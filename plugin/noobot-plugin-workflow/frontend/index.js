/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import WorkflowMessageCard from "./components/WorkflowMessageCard.vue";

export const FRONTEND_PLUGIN_API_VERSION = "1";

function isWorkflowMessageLike(messageItem = {}) {
  if (messageItem?.workflowMessage === true) return true;
  const type = String(messageItem?.type || "").trim().toLowerCase();
  if (type === "workflow") return true;
  const workflowMeta =
    messageItem?.workflowMeta &&
    typeof messageItem.workflowMeta === "object" &&
    !Array.isArray(messageItem.workflowMeta)
      ? messageItem.workflowMeta
      : null;
  const source = String(workflowMeta?.source || "").trim().toLowerCase();
  if (source === "workflow-plugin") return true;
  const phase = String(workflowMeta?.phase || "").trim().toLowerCase();
  return Boolean(workflowMeta && phase);
}

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
