/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildAttachmentUrl } from "../../services/api/chatApi";
import { mergeAttachmentMetas } from "./dialogProcessChain";
import {
  getMessageTransferAttachmentMetas,
  getMessageTransferEnvelopes,
} from "./transferEnvelopes";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

const EXECUTION_LOG_DISPLAY_LIMIT = 10;

function resolveBaseName(filePath = "") {
  const normalized = String(filePath || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/");
  return String(parts[parts.length - 1] || "").trim();
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
  { userId = "", isImageMime = () => false } = {},
) {
  const attachmentId = String(attachmentItem?.attachmentId || "").trim();
  const mimeType = String(
    attachmentItem?.mimeType || "application/octet-stream",
  );
  const sessionId = String(attachmentItem?.sessionId || "").trim();
  const attachmentSource = String(attachmentItem?.attachmentSource || "").trim();
  const attachmentUrl = attachmentId
    ? buildAttachmentUrl({
        userId,
        attachmentId,
        sessionId,
        attachmentSource,
      })
    : "";
  const parsedResultAttachmentId = String(
    attachmentItem?.parsedResultAttachmentId || "",
  ).trim();
  const parsedResultPath = String(attachmentItem?.parsedResultPath || "").trim();
  const parsedResultRelativePath = String(
    attachmentItem?.parsedResultRelativePath || "",
  ).trim();
  const parsedResultUrl = parsedResultAttachmentId
    ? buildAttachmentUrl({
        userId,
        attachmentId: parsedResultAttachmentId,
      })
    : "";
  const parsedResultName =
    resolveBaseName(parsedResultRelativePath) ||
    resolveBaseName(parsedResultPath) ||
    "";
  return {
    ...attachmentItem,
    sessionId,
    attachmentSource,
    mimeType,
    previewUrl:
      String(attachmentItem?.previewUrl || ""),
    parsedResultAttachmentId,
    parsedResultPath,
    parsedResultRelativePath,
    parsedResultUrl,
    parsedResultName,
  };
}

function isHarnessInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    String(messageItem?.injectedBy || "").trim() === "harness-plugin"
  );
}

function normalizeWorkflowMeta(messageItem = {}) {
  return messageItem?.pluginMeta &&
    typeof messageItem.pluginMeta === "object" &&
    !Array.isArray(messageItem.pluginMeta)
    ? messageItem.pluginMeta
    : null;
}

function isWorkflowMessageLike(messageItem = {}) {
  const type = String(messageItem?.type || "").trim().toLowerCase();
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  const source = String(workflowMeta?.source || "").trim().toLowerCase();
  const kind = String(workflowMeta?.kind || "").trim().toLowerCase();
  const phase = String(workflowMeta?.phase || "").trim().toLowerCase();
  return type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase);
}

function createMessageModel(messageItem = {}) {
  const normalizedAttachmentMetas = Array.isArray(messageItem?.attachmentMetas)
    ? messageItem.attachmentMetas
    : [];
  const transferResult =
    messageItem?.transferResult &&
    typeof messageItem.transferResult === "object" &&
    !Array.isArray(messageItem.transferResult)
      ? messageItem.transferResult
      : null;
  const transferEnvelopes = getMessageTransferEnvelopes(messageItem);
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  return {
    id: messageItem.id || "",
    messageId: messageItem.messageId || messageItem.id || "",
    role: messageItem.role || "assistant",
    content: messageItem.content || "",
    type: messageItem.type || "message",
    tool_calls: normalizeArray(messageItem.tool_calls),
    tool_call_id: messageItem.tool_call_id || "",
    dialogProcessId: messageItem.dialogProcessId || "",
    parentDialogProcessId: messageItem.parentDialogProcessId || "",
    modelAlias: messageItem.modelAlias || "",
    modelName: messageItem.modelName || messageItem.model || "",
    modelRuns: normalizeArray(messageItem.modelRuns),
    attachmentMetas: normalizeArray(normalizedAttachmentMetas),
    transferResult,
    transferEnvelopes,
    realtimeLogs: normalizeArray(messageItem.realtimeLogs),
    executionLogTotal: Number(
      messageItem?.executionLogTotal ??
        messageItem?.execution_log_total ??
        normalizeArray(messageItem.realtimeLogs).length,
    ),
    completedToolLogs: normalizeArray(messageItem.completedToolLogs),
    hasThinkingDetails: messageItem.hasThinkingDetails === true,
    thinkingDetailCount: Number(
      messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count ?? 0,
    ),
    thinkingOpenNames: normalizeArray(messageItem.thinkingOpenNames),
    expandedDetailLogKeys: normalizeArray(messageItem.expandedDetailLogKeys),
    error: messageItem.error || "",
    pending: Boolean(messageItem.pending),
    state: messageItem.state || "",
    status: messageItem.status || "",
    channelState: messageItem.channelState || "",
    statusLabel: messageItem.statusLabel || "",
    hasFirstStreamEvent: messageItem.hasFirstStreamEvent === true,
    ts: messageItem.ts || new Date().toISOString(),
    monotonicState: messageItem.monotonicState || "",
    stopState: messageItem.stopState || "",
    isMonotonic: messageItem.isMonotonic === true || messageItem.monotonic === true,
    taskId: messageItem.taskId || "",
    injectedMessage: messageItem.injectedMessage === true,
    injectedBy: String(messageItem.injectedBy || "").trim(),
    workflowMessage: isWorkflowMessageLike(messageItem),
    pluginMessage: messageItem.pluginMessage === true,
    pluginMeta: workflowMeta,
    workflowMeta,
  };
}

function buildAppendMessage(role, content = "", attachmentMetas = [], options = {}) {
  return createMessageModel({
    role,
    content,
    type: "message",
    attachmentMetas,
    ts: Date.now(),
  });
}

function resolveStableMessageIdentity(messageItem = {}) {
  return String(messageItem?.messageId || messageItem?.id || "").trim();
}

function buildViewMessage(
  messageItem = {},
  { userId = "", isImageMime = () => false } = {},
) {
  const sourceAttachmentMetas = Array.isArray(messageItem?.attachmentMetas)
    ? messageItem.attachmentMetas
    : [];
  const transferAttachmentMetas = getMessageTransferAttachmentMetas(messageItem);
  const normalizedAttachments = (transferAttachmentMetas.length
    ? mergeAttachmentMetas(transferAttachmentMetas, normalizeArray(sourceAttachmentMetas))
    : normalizeArray(sourceAttachmentMetas)
  ).map((attachmentItem) =>
    normalizeAttachment(attachmentItem, { userId, isImageMime }),
  );
  return createMessageModel({
    ...messageItem,
    attachmentMetas: normalizedAttachments,
  });
}

function foldConversationMessages(messages = [], buildView) {
  const foldedMessages = normalizeArray(messages)
    .filter((messageItem) => {
      if (isHarnessInjectedMessage(messageItem)) return false;
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
    const currentStableMessageIdentity = resolveStableMessageIdentity(currentMessage);
    const previousStableMessageIdentity = resolveStableMessageIdentity(previousMessage);
    const hasDifferentStableMessageIdentity =
      currentStableMessageIdentity &&
      previousStableMessageIdentity &&
      currentStableMessageIdentity !== previousStableMessageIdentity;
    const hasUnpairedStableMessageIdentity = Boolean(
      currentStableMessageIdentity || previousStableMessageIdentity,
    ) && currentStableMessageIdentity !== previousStableMessageIdentity;
    const canMergeAssistantMessage =
      previousMessage &&
      currentRole === "assistant" &&
      previousRole === "assistant" &&
      previousMessage?.workflowMessage !== true &&
      currentMessage?.workflowMessage !== true &&
      previousMessage?.pending !== true &&
      currentMessage?.pending !== true &&
      currentDialogProcessId &&
      previousDialogProcessId &&
      currentDialogProcessId === previousDialogProcessId &&
      !hasDifferentStableMessageIdentity &&
      !hasUnpairedStableMessageIdentity;
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
    const previousRealtimeLogs = normalizeArray(previousMessage?.realtimeLogs);
    const currentRealtimeLogs = normalizeArray(currentMessage?.realtimeLogs);
    previousMessage.realtimeLogs = [
      ...previousRealtimeLogs,
      ...currentRealtimeLogs,
    ].slice(-EXECUTION_LOG_DISPLAY_LIMIT);

    previousMessage.tool_calls = [...previousToolCalls, ...currentToolCalls];
    previousMessage.executionLogTotal = Math.max(
      Number(previousMessage?.executionLogTotal || 0),
      Number(currentMessage?.executionLogTotal || 0),
      normalizeArray(previousMessage?.realtimeLogs).length,
      normalizeArray(currentMessage?.realtimeLogs).length,
    );
    previousMessage.hasThinkingDetails =
      previousMessage.hasThinkingDetails === true || currentMessage.hasThinkingDetails === true;
    previousMessage.thinkingDetailCount = Math.max(
      Number(previousMessage?.thinkingDetailCount || 0),
      Number(currentMessage?.thinkingDetailCount || 0),
    );
    const currentAttachmentMetas = normalizeArray(currentMessage?.attachmentMetas);
    const previousAttachmentMetas = normalizeArray(previousMessage?.attachmentMetas);

    if (currentAttachmentMetas.length) {
      previousMessage.attachmentMetas = mergeAttachmentMetas(
        previousAttachmentMetas,
        currentAttachmentMetas,
      );
    }
    if (!previousMessage.transferResult && currentMessage.transferResult) {
      previousMessage.transferResult = currentMessage.transferResult;
    }
    const previousTransferEnvelopes = normalizeArray(previousMessage?.transferEnvelopes);
    const currentTransferEnvelopes = getMessageTransferEnvelopes(currentMessage);
    if (currentTransferEnvelopes.length) {
      previousMessage.transferEnvelopes = [
        ...previousTransferEnvelopes,
        ...currentTransferEnvelopes,
      ];
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
  EXECUTION_LOG_DISPLAY_LIMIT,
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
  createMessageModel,
  isHarnessInjectedMessage,
  isWorkflowMessageLike,
};
