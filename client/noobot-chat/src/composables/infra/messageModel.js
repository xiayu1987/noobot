/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveAttachmentAccessMeta,
  resolveParsedResultAccessMeta,
} from "../../services/api/attachmentAccess";
import { mergeAttachments } from "./dialogProcessChain";
import {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
} from "./transferEnvelopes";
import {
  getMessageContentIdentity,
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "./messageIdentity";
import {
  getMessageTimestamp,
  getThinkingFinishedAt,
  getThinkingStartedAt,
  nowIso,
  nowMs,
} from "./timeFields";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getMessageAttachments(messageItem = {}) {
  const sourceAttachments = Array.isArray(messageItem?.attachments)
    ? messageItem.attachments
    : [];
  const transferAttachments = getMessageTransferAttachments(messageItem).map((attachmentItem) =>
    enrichTransferAttachmentScope(attachmentItem, messageItem),
  );
  return transferAttachments.length
    ? mergeAttachments(transferAttachments, sourceAttachments)
    : sourceAttachments;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function enrichTransferAttachmentScope(attachmentItem = {}, messageItem = {}) {
  const sessionId = getMessageSessionId(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const parentDialogProcessId = getMessageParentDialogProcessId(messageItem);
  const role = getMessageRole(messageItem);
  if (!sessionId && !turnScopeId && !dialogProcessId && !parentDialogProcessId && !role) {
    return attachmentItem;
  }
  const owner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : {};
  const turnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : {};
  return {
    ...attachmentItem,
    ...(sessionId && !attachmentItem.sessionId && !attachmentItem.session_id ? { sessionId } : {}),
    owner: {
      ...(sessionId && !owner.sessionId && !owner.session_id ? { sessionId } : {}),
      ...(turnScopeId && !owner.turnScopeId ? { turnScopeId } : {}),
      ...(dialogProcessId && !owner.dialogProcessId && !owner.dialog_process_id ? { dialogProcessId } : {}),
      ...(role && !owner.role ? { role } : {}),
      ...owner,
    },
    turnScope: {
      ...(sessionId && !turnScope.sessionId && !turnScope.session_id ? { sessionId } : {}),
      ...(turnScopeId && !turnScope.turnScopeId ? { turnScopeId } : {}),
      ...(dialogProcessId && !turnScope.dialogProcessId && !turnScope.dialog_process_id ? { dialogProcessId } : {}),
      ...(parentDialogProcessId && !turnScope.parentDialogProcessId && !turnScope.parent_dialog_process_id
        ? { parentDialogProcessId }
        : {}),
      ...turnScope,
    },
  };
}

const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

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
  const attachmentAccess = resolveAttachmentAccessMeta(attachmentItem, { userId });
  const parsedAccess = resolveParsedResultAccessMeta(attachmentItem, { userId });
  const attachmentId = attachmentAccess.attachmentId;
  const mimeType = String(
    attachmentItem?.mimeType || "application/octet-stream",
  );
  const sessionId = attachmentAccess.sessionId;
  const attachmentSource = attachmentAccess.attachmentSource;
  const parsedResultSize = parsedAccess.size;
  return {
    ...attachmentItem,
    attachmentId,
    sessionId,
    attachmentSource,
    mimeType,
    url: attachmentAccess.url,
    previewUrl:
      String(attachmentItem?.previewUrl || ""),
    parsedResult: parsedAccess.hasIdentity
      ? {
          ...parsedAccess.raw,
          ...(parsedAccess.attachmentId ? { attachmentId: parsedAccess.attachmentId } : {}),
          ...(parsedAccess.sessionId ? { sessionId: parsedAccess.sessionId } : {}),
          ...(parsedAccess.attachmentSource ? { attachmentSource: parsedAccess.attachmentSource } : {}),
          ...(parsedResultSize !== null && parsedResultSize > 0 ? { size: parsedResultSize } : {}),
          ...(parsedAccess.path ? { path: parsedAccess.path } : {}),
          ...(parsedAccess.relativePath ? { relativePath: parsedAccess.relativePath } : {}),
        }
      : attachmentItem?.parsedResult,
    parsedResultAttachmentId: parsedAccess.attachmentId,
    parsedResultPath: parsedAccess.path,
    parsedResultRelativePath: parsedAccess.relativePath,
    parsedResultSessionId: parsedAccess.sessionId,
    parsedResultAttachmentSource: parsedAccess.attachmentSource,
    ...(parsedResultSize !== null && parsedResultSize > 0 ? { parsedResultSize } : {}),
    parsedResultUrl: parsedAccess.url,
    parsedResultName: parsedAccess.name,
  };
}

function isHarnessInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    String(messageItem?.injectedBy || "").trim() === "harness-plugin"
  );
}

function findVisibleLastMessage(messages = []) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (!isHarnessInjectedMessage(messageItem)) return messageItem || null;
  }
  return null;
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

function normalizeMessageType(messageItem = {}) {
  const rawType = String(messageItem?.type || "").trim();
  const normalizedType = rawType.toLowerCase();
  if (!rawType || ["constructor", "human", "ai", "assistant", "user"].includes(normalizedType)) {
    return "message";
  }
  if (normalizedType === "tool") return "tool_result";
  return rawType;
}

function createMessageModel(messageItem = {}) {
  const normalizedAttachments = getMessageAttachments(messageItem);
  const transferEnvelopes = getMessageTransferEnvelopes(messageItem);
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const sessionId = String(messageItem?.sessionId || messageItem?.session_id || "").trim();
  const thinkingStartedAt = getThinkingStartedAt(messageItem);
  const thinkingFinishedAt = getThinkingFinishedAt(messageItem);
  const messageTimestamp = getMessageTimestamp(messageItem);
  const messageRole = getMessageRole(messageItem) || "assistant";
  return {
    id: messageItem.id || "",
    turnScopeId,
    sessionId,
    session_id: sessionId,
    role: messageRole,
    content: getMessageContentIdentity(messageItem),
    type: normalizeMessageType(messageItem),
    tool_calls: normalizeArray(messageItem.tool_calls),
    tool_call_id: messageItem.tool_call_id || "",
    dialogProcessId: getMessageDialogProcessId(messageItem),
    parentDialogProcessId: getMessageParentDialogProcessId(messageItem),
    modelAlias: messageItem.modelAlias || "",
    modelName: messageItem.modelName || messageItem.model || "",
    modelRuns: normalizeArray(messageItem.modelRuns),
    attachments: normalizeArray(normalizedAttachments),
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
    thinkingStartedAt,
    thinkingFinishedAt,
    thinkingOpenNames: normalizeArray(messageItem.thinkingOpenNames),
    expandedDetailLogKeys: normalizeArray(messageItem.expandedDetailLogKeys),
    error: messageItem.error || "",
    pending: Boolean(messageItem.pending),
    state: messageItem.state || "",
    status: messageItem.status || "",
    channelState: messageItem.channelState || "",
    statusLabel: messageItem.statusLabel || "",
    hasFirstStreamEvent: messageItem.hasFirstStreamEvent === true,
    ts: messageTimestamp || nowIso(),
    taskId: messageItem.taskId || "",
    injectedMessage: messageItem.injectedMessage === true,
    injectedBy: String(messageItem.injectedBy || "").trim(),
    workflowMessage: isWorkflowMessageLike(messageItem),
    pluginMessage: messageItem.pluginMessage === true,
    pluginMeta: workflowMeta,
    workflowMeta,
  };
}

function buildAppendMessage(role, content = "", attachments = [], options = {}) {
  return createMessageModel({
    role,
    content,
    type: "message",
    attachments,
    ts: nowMs(),
  });
}

function resolveStableMessageIdentity(messageItem = {}) {
  return "";
}

function resolveMessageTurnScopeMergeKey(messageItem = {}) {
  const turnScopeId = getMessageTurnScopeId(messageItem);
  if (!turnScopeId) return "";
  const sessionId = String(messageItem?.sessionId || messageItem?.session_id || "").trim();
  return sessionId ? `${sessionId}::${turnScopeId}` : turnScopeId;
}

function buildViewMessage(
  messageItem = {},
  { userId = "", isImageMime = () => false } = {},
) {
  const normalizedAttachments = getMessageAttachments(messageItem).map((attachmentItem) =>
    normalizeAttachment(attachmentItem, { userId, isImageMime }),
  );
  return createMessageModel({
    ...messageItem,
    attachments: normalizedAttachments,
  });
}

function foldConversationMessages(messages = [], buildView) {
  const foldedMessages = normalizeArray(messages)
    .filter((messageItem) => {
      if (isHarnessInjectedMessage(messageItem)) return false;
      const role = getMessageRole(messageItem);
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
    const currentRole = getMessageRole(currentMessage);
    const previousRole = getMessageRole(previousMessage);
    const currentTurnScopeKey = resolveMessageTurnScopeMergeKey(currentMessage);
    const previousTurnScopeKey = resolveMessageTurnScopeMergeKey(previousMessage);
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
      currentTurnScopeKey &&
      previousTurnScopeKey &&
      currentTurnScopeKey === previousTurnScopeKey &&
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
    if (currentMessage.thinkingStartedAt) {
      previousMessage.thinkingStartedAt = currentMessage.thinkingStartedAt;
    }
    if (currentMessage.thinkingFinishedAt) {
      previousMessage.thinkingFinishedAt = currentMessage.thinkingFinishedAt;
    }
    const currentAttachments = normalizeArray(currentMessage?.attachments);
    const previousAttachments = normalizeArray(previousMessage?.attachments);

    if (currentAttachments.length) {
      previousMessage.attachments = mergeAttachments(
        previousAttachments,
        currentAttachments,
      );
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
  getMessageAttachments,
  findVisibleLastMessage,
  isHarnessInjectedMessage,
  isWorkflowMessageLike,
};
