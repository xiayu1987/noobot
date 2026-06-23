/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import ThinkingPanel from "../../../client/noobot-chat/src/shared/message/ThinkingPanel.vue";
import AssistantCopyActions from "./components/AssistantCopyActions.vue";
import MonotonicMessageActions from "./components/MonotonicMessageActions.vue";
import MessageStatusRow from "./components/MessageStatusRow.vue";
import MessageWrittenFiles from "./components/MessageWrittenFiles.vue";
import MessageAttachments from "./components/MessageAttachments.vue";
import HarnessModelExtension from "./components/HarnessModelExtension.vue";
import {
  findMessageIdentityIndex,
  getMessageDialogProcessId,
  getMessageRole,
  isSameMessageIdentity,
} from "../../../client/noobot-chat/src/composables/infra/messageIdentity.js";

export const FRONTEND_PLUGIN_API_VERSION = "1";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

const GENERATED_STATUS_LABEL = "\u5df2\u751f\u6210";
const STOPPED_STATUS_LABEL = "\u5df2\u505c\u6b62";

function isMonotonicMessage(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.isMonotonic === true || messageItem.monotonic === true) return true;
  if (normalizeText(messageItem.monotonicState) === "monotonic") return true;
  if (normalizeText(messageItem.stopState) === "stopped") return true;
  const state = normalizeText(messageItem.state || messageItem.status || messageItem.channelState);
  if (["completed", "done", "stopped"].includes(state)) return true;
  const label = normalizeText(messageItem.statusLabel);
  return ["generated", GENERATED_STATUS_LABEL, "stopped", STOPPED_STATUS_LABEL].includes(label);
}

function isUserMessage(messageItem = {}) {
  return normalizeText(getMessageRole(messageItem)) === "user";
}

function isPlainUserMessage(messageItem = {}) {
  if (!isUserMessage(messageItem)) return false;
  const type = normalizeText(messageItem?.type || messageItem?.messageType);
  return !type || type === "message" || type === "user";
}

function findMessageIndex(targetMessage = {}, allMessages = []) {
  return findMessageIdentityIndex(targetMessage, allMessages);
}

function resolveMonotonicUserTarget(messageItem = {}, allMessages = []) {
  if (!messageItem || typeof messageItem !== "object") return null;
  if (isUserMessage(messageItem)) return messageItem;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const directIndex = findMessageIndex(messageItem, messages);
  if (directIndex >= 0 && isUserMessage(messages[directIndex])) {
    return messages[directIndex];
  }
  const targetDialogProcessId = getMessageDialogProcessId(messageItem);
  if (targetDialogProcessId) {
    const sameDialogProcessUserMessage = messages.find(
      (item) => isUserMessage(item) && getMessageDialogProcessId(item) === targetDialogProcessId,
    );
    if (sameDialogProcessUserMessage) return sameDialogProcessUserMessage;
  }
  if (directIndex >= 0) {
    for (let index = directIndex - 1; index >= 0; index -= 1) {
      if (isUserMessage(messages[index])) return messages[index];
    }
  }
  return null;
}

function attachMonotonicSource(sourceMap, userMessage, sourceMessage) {
  if (!isUserMessage(userMessage) || !isMonotonicMessage(sourceMessage)) return;
  if (!sourceMap.has(userMessage)) sourceMap.set(userMessage, sourceMessage);
}

function buildMonotonicSourceMap(allMessages = []) {
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const sourceMap = new Map();

  for (const messageItem of messages) {
    if (isUserMessage(messageItem) && isMonotonicMessage(messageItem)) {
      attachMonotonicSource(sourceMap, messageItem, messageItem);
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const sourceMessage = messages[index];
    if (isUserMessage(sourceMessage) || !isMonotonicMessage(sourceMessage)) continue;

    const sourceDialogProcessId = getMessageDialogProcessId(sourceMessage);
    if (sourceDialogProcessId) {
      const sameDialogProcessUserMessage = messages.find(
        (item) => isUserMessage(item) && getMessageDialogProcessId(item) === sourceDialogProcessId,
      );
      if (sameDialogProcessUserMessage) {
        attachMonotonicSource(sourceMap, sameDialogProcessUserMessage, sourceMessage);
        continue;
      }
    }

    for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1) {
      const candidate = messages[prevIndex];
      if (isUserMessage(candidate)) {
        attachMonotonicSource(sourceMap, candidate, sourceMessage);
        break;
      }
    }
  }

  return sourceMap;
}

function getCachedMonotonicSourceMap(allMessages = []) {
  // Message monotonic flags are often applied in-place after Stop/channel-state
  // events. Caching only by array identity/length makes the action buttons stale
  // until a full remount. Rebuild from the current message fields every render.
  return buildMonotonicSourceMap(Array.isArray(allMessages) ? allMessages : []);
}

function getMonotonicSourceForUser(userMessage = {}, allMessages = []) {
  if (!isUserMessage(userMessage)) return null;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) {
    return isMonotonicMessage(userMessage) ? userMessage : null;
  }
  const sourceMap = getCachedMonotonicSourceMap(messages);
  const directSource = sourceMap.get(userMessage);
  if (directSource) return directSource;
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex >= 0) return sourceMap.get(messages[userIndex]) || null;
  for (const [mappedUser, sourceMessage] of sourceMap.entries()) {
    if (isSameMessageIdentity(mappedUser, userMessage)) return sourceMessage;
  }
  return null;
}

function isTailOrphanUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage) || isMonotonicMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) return true;

  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;

  const userDialogProcessId = getMessageDialogProcessId(userMessage);
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const nextMessage = messages[index];
    if (userDialogProcessId && getMessageDialogProcessId(nextMessage) !== userDialogProcessId) continue;
    return false;
  }

  return true;
}

function isLatestUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    if (isPlainUserMessage(messages[index])) return false;
  }
  return true;
}

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
      {
        id: "monotonic-message-actions",
        capability: "message.action.monotonic",
        priority: 110,
        component: MonotonicMessageActions,
        match: (messageItem = {}) => isUserMessage(messageItem) || isMonotonicMessage(messageItem),
        resolveProps: (context = {}) => {
          const messageItem =
            context?.messageItem && typeof context.messageItem === "object"
              ? context.messageItem
              : {};
          const allMessages = Array.isArray(context?.allMessages) ? context.allMessages : [];
          const monotonicUserTarget = resolveMonotonicUserTarget(
            messageItem,
            allMessages,
          );
          const canDelete = typeof context?.deleteMonotonicMessage === "function";
          const canResend = typeof context?.resendMonotonicMessage === "function";
          const shouldMountOnCurrentUser =
            isUserMessage(messageItem) &&
            Boolean(monotonicUserTarget) &&
            isSameMessageIdentity(messageItem, monotonicUserTarget) &&
            isLatestUserMessage(messageItem, allMessages) &&
            (Boolean(getMonotonicSourceForUser(messageItem, allMessages)) ||
              isTailOrphanUserMessage(messageItem, allMessages));
          return {
            visible: shouldMountOnCurrentUser && (canDelete || canResend),
            disabled: context?.sending === true,
            messageItem: monotonicUserTarget || messageItem,
            onDelete: canDelete ? context.deleteMonotonicMessage : null,
            onResend: canResend ? context.resendMonotonicMessage : null,
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
        component: MessageAttachments,
        match: () => true,
        resolveProps: (context = {}) => ({
          attachments: Array.isArray(context?.displayedAttachmentMetas)
            ? context.displayedAttachmentMetas
            : [],
          isImageMime: context?.isImageMime,
          canPreviewAttachment: context?.canPreviewAttachment,
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
          download:
            typeof context?.onDownloadAttachment === "function"
              ? context.onDownloadAttachment
              : null,
        }),
      },
    ],
  });
}
