/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ThinkingPanel } from "../../../client/noobot-chat/src/public/chat-ui.js";
import AssistantCopyActions from "./components/AssistantCopyActions.vue";
import MessageStatusRow from "./components/MessageStatusRow.vue";
import MessageWrittenFiles from "./components/MessageWrittenFiles.vue";
import MessageAttachments from "./components/MessageAttachments.vue";
import HarnessModelExtension from "./components/HarnessModelExtension.vue";

export function matchesMessageStatusRow(messageItem = {}) {
  return messageItem?.role === "assistant" && Boolean(
    messageItem?.pending ||
    messageItem?.statusLabel ||
    messageItem?.statusTurnScopeId ||
    messageItem?.projectedStatusStepState ||
    messageItem?.persistedStatusStepState
  );
}

export function matchesThinkingPanel(messageItem = {}) {
  return messageItem?.role === "assistant";
}

export const FRONTEND_PLUGIN_API_VERSION = "1";

export function registerFrontendPlugin(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const attachmentService = ctx?.services?.attachments || null;
  const thinkingDetailService = ctx?.services?.thinkingDetails || null;
  if (typeof contribute !== "function" || !points) {
    throw new Error("frontend contribution API is required");
  }
  contribute(points.COMPOSER_OPTIONS_MODEL, {
        id: "harness-model-extension",
        capability: "composer.model-extension",
        priority: 10,
        component: HarnessModelExtension,
        resolveProps: (context = {}) => ({ pluginContext: context.pluginContext?.("harness") }),
  });
  contribute(points.MESSAGE_CARD_PRE, {
        id: "message-status-row",
        capability: "message.panel.status",
        slot: "pre",
        priority: 5,
        component: MessageStatusRow,
        when: (context = {}) => matchesMessageStatusRow(context?.messageItem),
        resolveProps: (context = {}) => ({
          pending: context?.messageItem?.pending,
          statusLabel: context?.messageItem?.statusLabel,
          showSubTask: context?.showSubTaskActivity === true,
          subTaskStatusText: context?.subTaskStatusText,
          statusStepState: context?.statusStepState,
        }),
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
  contribute(points.MESSAGE_ACTION_AFTER_PRE_CARDS, {
        id: "assistant-copy-actions",
        capability: "message.action.assistant.copy",
        placement: "after-pre-cards",
        priority: 100,
        component: AssistantCopyActions,
        when: (context = {}) => context?.messageItem?.role === "assistant",
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
  });
  contribute(points.MESSAGE_CARD_POST, {
        id: "message-written-files",
        capability: "message.panel.assets",
        slot: "post",
        priority: 10,
        suppressDefaultAssets: true,
        component: MessageWrittenFiles,
        when: (context = {}) => context?.messageItem?.role === "assistant",
        resolveProps: (context = {}) => ({
          writtenFiles: Array.isArray(context?.writtenFiles) ? context.writtenFiles : [],
        }),
        resolveListeners: (context = {}) => ({
          preview:
            typeof context?.onOpenFilePreview === "function" ? context.onOpenFilePreview : null,
          download:
            typeof context?.onDownloadFile === "function" ? context.onDownloadFile : null,
        }),
  });
  contribute(points.MESSAGE_CARD_POST, {
        id: "message-attachments",
        capability: "message.panel.assets",
        slot: "post",
        priority: 20,
        suppressDefaultAssets: true,
        component: MessageAttachments,
        when: () => true,
        resolveProps: (context = {}) => ({
          attachments: Array.isArray(context?.displayedAttachments)
            ? context.displayedAttachments
            : [],
          isImageMime: context?.isImageMime,
          canPreviewAttachment: context?.canPreviewAttachment,
          canPreviewParsedResult: context?.canPreviewParsedResult,
          formatFileSize: context?.formatFileSize,
          userId: String(context?.userId || ""),
          attachmentService,
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
  });
}
