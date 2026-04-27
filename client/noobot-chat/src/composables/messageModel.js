/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildAttachmentUrl } from "../api/chatApi";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildModelRunLabel(messageItem = {}) {
  const modelAlias = String(messageItem?.modelAlias || "").trim();
  const modelName = String(
    messageItem?.modelName || messageItem?.model || "",
  ).trim();
  if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
  return modelAlias || modelName || "";
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
      (attachmentUrl &&
      (isImageMime(mimeType) || mimeType.startsWith("video/"))
        ? attachmentUrl
        : ""),
  };
}

function createMessageModel(messageItem = {}) {
  const normalizedAttachmentMetas = Array.isArray(messageItem?.attachmentMetas)
    ? messageItem.attachmentMetas
    : Array.isArray(messageItem?.attachments)
      ? messageItem.attachments
      : [];
  return {
    role: messageItem.role || "assistant",
    content: messageItem.content || "",
    type: messageItem.type || "message",
    tool_calls: normalizeArray(messageItem.tool_calls),
    tool_call_id: messageItem.tool_call_id || "",
    dialogProcessId: messageItem.dialogProcessId || "",
    modelAlias: messageItem.modelAlias || "",
    modelName: messageItem.modelName || messageItem.model || "",
    modelRuns: normalizeArray(messageItem.modelRuns),
    attachmentMetas: normalizeArray(normalizedAttachmentMetas),
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

function buildAppendMessage(role, content = "", attachmentMetas = []) {
  return createMessageModel({
    role,
    content,
    type: "message",
    attachmentMetas,
    ts: Date.now(),
  });
}

function buildViewMessage(
  messageItem = {},
  { userId = "", apiKey = "", isImageMime = () => false } = {},
) {
  const sourceAttachmentMetas = Array.isArray(messageItem?.attachmentMetas)
    ? messageItem.attachmentMetas
    : Array.isArray(messageItem?.attachments)
      ? messageItem.attachments
      : [];
  const normalizedAttachments = normalizeArray(sourceAttachmentMetas).map(
    (attachmentItem) =>
      normalizeAttachment(attachmentItem, { userId, apiKey, isImageMime }),
  );
  return createMessageModel({
    ...messageItem,
    attachmentMetas: normalizedAttachments,
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
    const currentModelRunLabel = buildModelRunLabel(currentMessage);
    if (currentModelRunLabel) {
      const currentModelRuns = normalizeArray(currentMessage.modelRuns);
      if (!currentModelRuns.includes(currentModelRunLabel)) {
        currentMessage.modelRuns = [...currentModelRuns, currentModelRunLabel];
      }
    }

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
    const currentAttachmentMetas = normalizeArray(currentMessage?.attachmentMetas);
    const previousAttachmentMetas = normalizeArray(previousMessage?.attachmentMetas);

    if (currentAttachmentMetas.length && !previousAttachmentMetas.length) {
      previousMessage.attachmentMetas = currentAttachmentMetas;
    }
    previousMessage.ts = currentMessage?.ts || previousMessage?.ts;
    if (String(currentMessage?.modelAlias || "").trim()) {
      previousMessage.modelAlias = String(currentMessage.modelAlias || "").trim();
    }
    if (String(currentMessage?.modelName || "").trim()) {
      previousMessage.modelName = String(currentMessage.modelName || "").trim();
    }
    const previousModelRuns = normalizeArray(previousMessage?.modelRuns);
    const currentModelRuns = normalizeArray(currentMessage?.modelRuns);
    const mergedModelRuns = Array.from(
      new Set([...previousModelRuns, ...currentModelRuns].filter(Boolean)),
    );
    previousMessage.modelRuns = mergedModelRuns;
  }
  return mergedMessages;
}

export {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
  createMessageModel,
};
