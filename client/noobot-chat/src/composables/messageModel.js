/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildAttachmentUrl } from "../api/chatApi";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAttachment(
  attachmentItem = {},
  { userId = "", apiKey = "", isImageMime = () => false } = {},
) {
  const attachmentId = String(attachmentItem?.attachmentId || "").trim();
  const mimeType = String(
    attachmentItem?.mimeType || "application/octet-stream",
  );
  const attachmentUrl = attachmentId
    ? buildAttachmentUrl({ userId, attachmentId, apiKey })
    : "";
  return {
    ...attachmentItem,
    mimeType,
    previewUrl:
      String(attachmentItem?.previewUrl || "") ||
      (attachmentUrl && isImageMime(mimeType) ? attachmentUrl : ""),
  };
}

function createMessageModel(messageItem = {}) {
  return {
    role: messageItem.role || "assistant",
    content: messageItem.content || "",
    type: messageItem.type || "message",
    tool_calls: normalizeArray(messageItem.tool_calls),
    tool_call_id: messageItem.tool_call_id || "",
    dialogProcessId: messageItem.dialogProcessId || "",
    attachments: normalizeArray(messageItem.attachments),
    realtimeLogs: normalizeArray(messageItem.realtimeLogs),
    completedToolLogs: normalizeArray(messageItem.completedToolLogs),
    thinkingOpenNames: normalizeArray(messageItem.thinkingOpenNames),
    expandedDetailLogKeys: normalizeArray(messageItem.expandedDetailLogKeys),
    error: messageItem.error || "",
    pending: Boolean(messageItem.pending),
    statusLabel: messageItem.statusLabel || "",
    ts: messageItem.ts || new Date().toISOString(),
    taskId: messageItem.taskId || "",
  };
}

function buildAppendMessage(role, content = "", attachments = []) {
  return createMessageModel({
    role,
    content,
    type: "message",
    attachments,
    ts: Date.now(),
  });
}

function buildViewMessage(
  messageItem = {},
  { userId = "", apiKey = "", isImageMime = () => false } = {},
) {
  const normalizedAttachments = normalizeArray(messageItem.attachments).map(
    (attachmentItem) =>
      normalizeAttachment(attachmentItem, { userId, apiKey, isImageMime }),
  );
  return createMessageModel({
    ...messageItem,
    attachments: normalizedAttachments,
  });
}

function foldConversationMessages(messages = [], buildView) {
  const foldedMessages = normalizeArray(messages)
    .filter((messageItem) => {
      const role = String(messageItem?.role || "");
      return role === "assistant" || role === "user";
    })
    .map((messageItem) => buildView(messageItem));

  const mergedMessages = [];
  for (const currentMessage of foldedMessages) {
    const previousMessage = mergedMessages[mergedMessages.length - 1] || null;
    const currentRole = String(currentMessage?.role || "");
    const previousRole = String(previousMessage?.role || "");
    const currentDialogProcessId = String(
      currentMessage?.dialogProcessId || "",
    ).trim();
    const previousDialogProcessId = String(
      previousMessage?.dialogProcessId || "",
    ).trim();
    const canMergeAssistantMessage =
      previousMessage &&
      currentRole === "assistant" &&
      previousRole === "assistant" &&
      currentDialogProcessId &&
      previousDialogProcessId &&
      currentDialogProcessId === previousDialogProcessId;
    if (!canMergeAssistantMessage) {
      mergedMessages.push(currentMessage);
      continue;
    }

    const previousContent = String(previousMessage?.content || "").trim();
    const currentContent = String(currentMessage?.content || "").trim();
    const mergedContent = [previousContent, currentContent].filter(Boolean).join("\n\n");
    previousMessage.content = mergedContent;

    const currentType = String(currentMessage?.type || "").trim();
    if (currentType && currentType !== "tool_call") {
      previousMessage.type = currentType;
    }
    const previousToolCalls = normalizeArray(previousMessage?.tool_calls);
    const currentToolCalls = normalizeArray(currentMessage?.tool_calls);
    previousMessage.tool_calls = [...previousToolCalls, ...currentToolCalls];
    const currentAttachments = normalizeArray(currentMessage?.attachments);
    const previousAttachments = normalizeArray(previousMessage?.attachments);

    if (currentAttachments.length && !previousAttachments.length) {
      previousMessage.attachments = currentAttachments;
    }
    previousMessage.ts = currentMessage?.ts || previousMessage?.ts;
  }
  return mergedMessages;
}

export {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
  createMessageModel,
};
