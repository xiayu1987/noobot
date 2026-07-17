/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import ThinkingPanel from "../../../client/noobot-chat/src/shared/message/ThinkingPanel.vue";
import AssistantCopyActions from "./components/AssistantCopyActions.vue";
import MessageStatusRow from "./components/MessageStatusRow.vue";
import MessageWrittenFiles from "./components/MessageWrittenFiles.vue";
import MessageAttachments from "./components/MessageAttachments.vue";
import HarnessModelExtension from "./components/HarnessModelExtension.vue";

export const FRONTEND_PLUGIN_API_VERSION = "1";

export function registerFrontendPlugin(ctx = {}) {
  const register = ctx?.registerFrontendPlugin;
  if (typeof register !== "function") {
    throw new Error("frontend register API is required");
  }
  register({
    id: "harness",
    name: "harness-model-extension",
    capabilities: ["composer.model-extension"],
    composerModelExtensions: [
      {
        id: "harness-model-extension",
        capability: "composer.model-extension",
        priority: 10,
        component: HarnessModelExtension,
      },
    ],
  });
  register({
    id: "message-status",
    name: "message-status-row",
    capabilities: ["message.panel.status"],
    messageCards: [
      {
        id: "message-status-row",
        capability: "message.panel.status",
        slot: "pre",
        priority: 5,
        component: MessageStatusRow,
        match: (messageItem = {}) =>
          messageItem?.role === "assistant" &&
          Boolean(messageItem?.pending || messageItem?.statusLabel),
        resolveProps: (context = {}) => ({
          pending: context?.messageItem?.pending,
          statusLabel: context?.messageItem?.statusLabel,
          showSubTask: context?.showSubTaskActivity === true,
          subTaskStatusText: context?.subTaskStatusText,
          statusStepState: context?.statusStepState,
        }),
      },
    ],
  });
  register({
    id: "message-thinking",
    name: "thinking-panel",
    capabilities: ["message.panel.thinking"],
    messageCards: [
      {
        id: "thinking-panel",
        capability: "message.panel.thinking",
        slot: "pre",
        priority: 10,
        component: ThinkingPanel,
        match: () => true,
        resolveProps: (context = {}) => ({
          messageItem: context?.messageItem || {},
          allMessages: Array.isArray(context?.allMessages) ? context.allMessages : [],
          turnTimingsByTurnScopeId: context?.turnTimingsByTurnScopeId || {},
        }),
        resolveListeners: (context = {}) => ({
          "open-thinking-details": (payload = {}) => {
            if (typeof context?.onOpenThinkingDetails === "function") {
              context.onOpenThinkingDetails(payload);
            }
          },
        }),
      },
    ],
  });
  register({
    id: "message-actions",
    name: "assistant-copy-actions",
    capabilities: ["message.action.assistant.copy"],
    messageActions: [
      {
        id: "assistant-copy-actions",
        capability: "message.action.assistant.copy",
        placement: "after-pre-cards",
        priority: 100,
        component: AssistantCopyActions,
        match: (messageItem = {}) => messageItem?.role === "assistant",
        resolveProps: (context = {}) => {
          const messageItem =
            context?.messageItem && typeof context.messageItem === "object"
              ? context.messageItem
              : {};
          const content = String(messageItem?.content || "").trim();
          return {
            visible: messageItem?.role === "assistant" && Boolean(content),
            onCopyRich:
              typeof context?.onCopyMessageRich === "function"
                ? context.onCopyMessageRich
                : null,
            onCopyText:
              typeof context?.onCopyMessageText === "function"
                ? context.onCopyMessageText
                : null,
            translate:
              typeof context?.translate === "function" ? context.translate : (key = "") => key,
          };
        },
      },
    ],
  });
  register({
    id: "message-assets",
    name: "message-assets",
    capabilities: ["message.panel.assets"],
    messageCards: [
      {
        id: "message-written-files",
        capability: "message.panel.assets",
        slot: "post",
        priority: 10,
        suppressDefaultAssets: true,
        component: MessageWrittenFiles,
        match: (messageItem = {}) => messageItem?.role === "assistant",
        resolveProps: (context = {}) => ({
          writtenFiles: Array.isArray(context?.writtenFiles) ? context.writtenFiles : [],
        }),
        resolveListeners: (context = {}) => ({
          preview:
            typeof context?.onOpenFilePreview === "function" ? context.onOpenFilePreview : null,
          download:
            typeof context?.onDownloadFile === "function" ? context.onDownloadFile : null,
        }),
      },
      {
        id: "message-attachments",
        capability: "message.panel.assets",
        slot: "post",
        priority: 20,
        suppressDefaultAssets: true,
        component: MessageAttachments,
        match: () => true,
        resolveProps: (context = {}) => ({
          attachments: Array.isArray(context?.displayedAttachments)
            ? context.displayedAttachments
            : [],
          isImageMime: context?.isImageMime,
          canPreviewAttachment: context?.canPreviewAttachment,
          canPreviewParsedResult: context?.canPreviewParsedResult,
          formatFileSize: context?.formatFileSize,
          userId: String(context?.userId || ""),
          authFetch:
            typeof context?.authFetch === "function" ? context.authFetch : null,
        }),
        resolveListeners: (context = {}) => ({
          preview:
            typeof context?.onOpenAttachmentPreview === "function"
              ? context.onOpenAttachmentPreview
              : null,
          "preview-resolved":
            typeof context?.onOpenResolvedAttachmentPreview === "function"
              ? context.onOpenResolvedAttachmentPreview
              : null,
          download:
            typeof context?.onDownloadAttachment === "function"
              ? context.onDownloadAttachment
              : null,
        }),
      },
    ],
  });
}
