/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ThinkingPanel } from "noobot-chat/plugin-api/chat-ui";
import MessageWrittenFiles from "./components/MessageWrittenFiles.vue";
import MessageAttachments from "./components/MessageAttachments.vue";
import HarnessModelExtension from "./components/HarnessModelExtension.vue";

export function matchesThinkingPanel(messageItem = {}) {
  return messageItem?.role === "assistant";
}

export const FRONTEND_PLUGIN_API_VERSION = "1";

function createThinkingDetailService(authenticatedGet) {
  if (typeof authenticatedGet !== "function") return null;
  return Object.freeze({
    getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
      const query = new URLSearchParams();
      if (String(dialogProcessId).trim()) query.set("dialogProcessId", String(dialogProcessId).trim());
      if (String(turnScopeId).trim()) query.set("turnScopeId", String(turnScopeId).trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return authenticatedGet(
        `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail${suffix}`,
      );
    },
  });
}

export function registerFrontendPlugin(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const thinkingDetailService = createThinkingDetailService(ctx?.services?.authenticatedRequest?.get);
  if (typeof contribute !== "function" || !points) {
    throw new Error("frontend contribution API is required");
  }
  contribute(points.MESSAGE_LOG_COMPATIBILITY, {
    id: "harness-legacy-log-compatibility",
    provide: ({ kind, value } = {}) => {
      if (kind === "flow") return [value?.harnessFlow ?? value?.data?.harnessFlow].filter((item) => item != null);
      if (kind === "capability-response-event") return [value === "harness_capability_response"];
      if (kind === "model-response-text") {
        return [String(value || "").replace(/^Harness\s+模型返回\s*\/\s*[^\n]+\n?/i, "").trim()];
      }
      return [];
    },
  });
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
