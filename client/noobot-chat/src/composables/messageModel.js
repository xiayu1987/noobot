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
  return normalizeArray(messages)
    .filter((messageItem) => {
      const role = String(messageItem?.role || "");
      return role === "assistant" || role === "user";
    })
    .map((messageItem) => buildView(messageItem));
}

export {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
  createMessageModel,
};
