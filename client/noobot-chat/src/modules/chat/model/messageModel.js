/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveAttachmentAccessMeta,
} from "../../../infrastructure/api/attachments/attachmentAccess.js";
import { mergeAttachments } from "./dialogProcessChain.js";
import { getMessageTransferAttachments, getMessageTransferEnvelopes } from "./transferEnvelopes.js";
import {
  getMessageContentIdentity,
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "./messageIdentity.js";
import { getMessageTimestamp, nowIso, nowMs } from "./timeFields.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { initializeMessageEventState } from "./messageEventState.js";
import {
  mergeToolTimelines,
  selectCompletedToolArtifacts,
} from "../runtime/engine/toolTimeline.js";
import { mergeActivityTimelines } from "../runtime/engine/activityTimeline.js";
import {
  mergeMessagePresentationFacets,
  normalizeStatusStepDisplayState,
} from "./messagePresentation.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getMessageAttachments(messageItem = {}) {
  const sourceAttachments = Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
  const transferAttachments = getMessageTransferAttachments(messageItem);
  const toolTimelineAttachments = selectCompletedToolArtifacts(messageItem).attachments;
  const derivedAttachments = mergeAttachments(transferAttachments, toolTimelineAttachments);
  return derivedAttachments.length
    ? mergeAttachments(derivedAttachments, sourceAttachments)
    : sourceAttachments;
}

const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

function buildModelRunLabel(messageItem = {}) {
  const modelAlias = String(messageItem?.modelAlias || "").trim();
  const modelName = String(messageItem?.modelName || messageItem?.model || "").trim();
  if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
  return modelAlias || modelName || "";
}

function normalizeAttachment(attachmentItem = {}, { userId = "" } = {}) {
  const attachmentAccess = resolveAttachmentAccessMeta(attachmentItem, { userId });
  const attachmentId = attachmentAccess.attachmentId;
  const mimeType = String(attachmentItem?.mimeType || "application/octet-stream");
  const sessionId = attachmentAccess.sessionId;
  const attachmentSource = attachmentAccess.attachmentSource;
  return {
    ...attachmentItem,
    attachmentId,
    sessionId,
    attachmentSource,
    mimeType,
    url: attachmentAccess.url,
    previewUrl: String(attachmentItem?.previewUrl || ""),
  };
}

function isPluginInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true && Boolean(String(messageItem?.injectedBy || "").trim())
  );
}

function findVisibleLastMessage(messages = []) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (!isPluginInjectedMessage(messageItem)) return messageItem || null;
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
  const type = String(messageItem?.type || "")
    .trim()
    .toLowerCase();
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  const source = String(workflowMeta?.source || "")
    .trim()
    .toLowerCase();
  const kind = String(workflowMeta?.kind || "")
    .trim()
    .toLowerCase();
  const phase = String(workflowMeta?.phase || "")
    .trim()
    .toLowerCase();
  return (
    type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase)
  );
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
  const canonicalMessage = messageItem;
  const normalizedAttachments = getMessageAttachments(canonicalMessage);
  const transferEnvelopes = getMessageTransferEnvelopes(canonicalMessage);
  const workflowMeta = normalizeWorkflowMeta(canonicalMessage);
  const turnScopeId = getMessageTurnScopeId(canonicalMessage);
  const sessionId = String(
    canonicalMessage?.sessionId || canonicalMessage?.session_id || "",
  ).trim();
  const messageTimestamp = getMessageTimestamp(canonicalMessage);
  const messageRole = getMessageRole(canonicalMessage) || "assistant";
  const sourceMessageId = String(canonicalMessage?.messageId || canonicalMessage?.id || "").trim();
  const presentationMessageId = String(canonicalMessage?.presentationMessageId || "").trim();
  const messageId =
    messageRole === "assistant" && presentationMessageId ? presentationMessageId : sourceMessageId;
  const messageType = normalizeMessageType(canonicalMessage);
  const activityTimeline = normalizeArray(canonicalMessage.activityTimeline);
  return initializeMessageEventState({
    id: messageId,
    messageId,
    ...(presentationMessageId ? { presentationMessageId } : {}),
    ...(sourceMessageId && sourceMessageId !== messageId ? { sourceMessageId } : {}),
    turnScopeId,
    sessionId,
    session_id: sessionId,
    role: messageRole,
    chatPresentation: canonicalMessage.chatPresentation,
    content:
      canonicalMessage?.chatPresentation === false
        ? ""
        : getMessageContentIdentity(canonicalMessage),
    type: messageType,
    tool_calls: normalizeArray(canonicalMessage.tool_calls),
    toolCalls: normalizeArray(canonicalMessage.toolCalls),
    tool_call_id: canonicalMessage.tool_call_id || "",
    thinking: canonicalMessage.thinking,
    toolCall: canonicalMessage.toolCall,
    toolResult: canonicalMessage.toolResult,
    rawEvents: normalizeArray(canonicalMessage.rawEvents),
    dialogProcessId: getMessageDialogProcessId(canonicalMessage),
    parentDialogProcessId: getMessageParentDialogProcessId(canonicalMessage),
    modelAlias: canonicalMessage.modelAlias || "",
    modelName: canonicalMessage.modelName || canonicalMessage.model || "",
    modelRuns: normalizeArray(canonicalMessage.modelRuns),
    attachments: normalizeArray(normalizedAttachments),
    transferEnvelopes,
    toolTimeline: normalizeArray(canonicalMessage.toolTimeline),
    activityTimeline,
    messageEventState: canonicalMessage.messageEventState,
    hasThinkingDetails: canonicalMessage.hasThinkingDetails === true,
    thinkingDetailCount: Number(
      canonicalMessage?.thinkingDetailCount ?? canonicalMessage?.thinking_detail_count ?? 0,
    ),
    error: canonicalMessage.error || "",
    pending: Boolean(canonicalMessage.pending),
    synthetic: canonicalMessage.synthetic === true,
    placeholder: canonicalMessage.placeholder === true,
    turnPlaceholder: canonicalMessage.turnPlaceholder === true,
    state: canonicalMessage.state || "",
    status: canonicalMessage.status || "",
    channelState: canonicalMessage.channelState || "",
    statusLabel: canonicalMessage.statusLabel || "",
    statusTurnScopeId: String(canonicalMessage.statusTurnScopeId || "").trim(),
    projectedStatusStepState: normalizeStatusStepDisplayState(
      canonicalMessage.projectedStatusStepState,
    ),
    hasFirstStreamEvent: canonicalMessage.hasFirstStreamEvent === true,
    ts: messageTimestamp || nowIso(),
    taskId: canonicalMessage.taskId || "",
    noobotInternalMessageType: String(
      canonicalMessage?.noobotInternalMessageType ||
        canonicalMessage?.additional_kwargs?.noobotInternalMessageType ||
        canonicalMessage?.metadata?.noobotInternalMessageType ||
        "",
    ).trim(),
    injectedMessage: canonicalMessage.injectedMessage === true,
    injectedBy: String(canonicalMessage.injectedBy || "").trim(),
    workflowMessage: isWorkflowMessageLike(canonicalMessage),
    pluginMessage: canonicalMessage.pluginMessage === true,
    pluginMeta: workflowMeta,
    workflowMeta,
  });
}

function buildAppendMessage(role, content = "", attachments = [], options = {}) {
  return createMessageModel({
    ...options,
    role,
    content,
    type: "message",
    attachments,
    ts: nowMs(),
  });
}

function resolveStableMessageIdentity(messageItem = {}) {
  const presentationMessageId = String(messageItem?.presentationMessageId || "").trim();
  if (getMessageRole(messageItem) === "assistant" && presentationMessageId) {
    return presentationMessageId;
  }
  return String(messageItem?.messageId || messageItem?.id || "").trim();
}

function resolveMessageTurnScopeMergeKey(messageItem = {}) {
  const turnScopeId = getMessageTurnScopeId(messageItem);
  if (!turnScopeId) return "";
  const sessionId = String(messageItem?.sessionId || messageItem?.session_id || "").trim();
  return sessionId ? `${sessionId}::${turnScopeId}` : turnScopeId;
}

function normalizeFoldedPresentationMessage(sourceMessage = {}, projectedMessage = {}) {
  const messageRole = getMessageRole(projectedMessage) || getMessageRole(sourceMessage);
  const presentationMessageId = String(
    projectedMessage?.presentationMessageId || sourceMessage?.presentationMessageId || "",
  ).trim();
  const sourceMessageId = String(
    projectedMessage?.sourceMessageId ||
      sourceMessage?.sourceMessageId ||
      sourceMessage?.messageId ||
      sourceMessage?.id ||
      "",
  ).trim();
  const normalizedMessage = { ...projectedMessage };

  if (messageRole === "assistant" && presentationMessageId) {
    normalizedMessage.id = presentationMessageId;
    normalizedMessage.messageId = presentationMessageId;
    normalizedMessage.presentationMessageId = presentationMessageId;
    if (sourceMessageId && sourceMessageId !== presentationMessageId) {
      normalizedMessage.sourceMessageId = sourceMessageId;
    }
  }

  // Canonical model-history records contribute presentation facets while
  // remaining excluded from the chat body.
  if (sourceMessage?.chatPresentation === false) {
    normalizedMessage.content = "";
  }
  return normalizedMessage;
}

function buildViewMessage(messageItem = {}, { userId = "" } = {}) {
  const normalizedAttachments = getMessageAttachments(messageItem).map((attachmentItem) =>
    normalizeAttachment(attachmentItem, {
      userId,
    }),
  );
  return createMessageModel({
    ...messageItem,
    attachments: normalizedAttachments,
  });
}

function foldConversationMessages(messages = [], buildView) {
  const sourceMessages = normalizeArray(messages);
  const foldedMessages = sourceMessages
    .filter((messageItem) => {
      if (isPluginInjectedMessage(messageItem)) return false;
      const role = getMessageRole(messageItem);
      if (role !== "assistant" && messageItem?.chatPresentation === false) return false;
      return role === "assistant" || role === "user";
    })
    .map((messageItem) => normalizeFoldedPresentationMessage(messageItem, buildView(messageItem)));

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
    const hasUnpairedStableMessageIdentity =
      Boolean(currentStableMessageIdentity || previousStableMessageIdentity) &&
      currentStableMessageIdentity !== previousStableMessageIdentity;
    const canMergeAssistantMessage =
      previousMessage &&
      currentRole === "assistant" &&
      previousRole === "assistant" &&
      previousMessage?.workflowMessage !== true &&
      currentMessage?.workflowMessage !== true &&
      currentTurnScopeKey &&
      previousTurnScopeKey &&
      currentTurnScopeKey === previousTurnScopeKey &&
      !hasDifferentStableMessageIdentity &&
      !hasUnpairedStableMessageIdentity &&
      !(previousMessage?.chatPresentation === true && currentMessage?.chatPresentation === true);
    if (!canMergeAssistantMessage) {
      mergedMessages.push(currentMessage);
      continue;
    }

    const previousContent = String(previousMessage?.content || "").trim();
    const currentContent = String(currentMessage?.content || "").trim();
    const mergedContent =
      previousContent && previousContent === currentContent
        ? previousContent
        : [previousContent, currentContent].filter(Boolean).join("\n\n");
    previousMessage.content = mergedContent;
    if (currentMessage?.chatPresentation === true) {
      previousMessage.chatPresentation = true;
    }

    const currentType = String(currentMessage?.type || "").trim();
    if (currentType && currentType !== "tool_call") {
      previousMessage.type = currentType;
    }
    const previousToolCalls = normalizeArray(previousMessage?.tool_calls);
    const currentToolCalls = normalizeArray(currentMessage?.tool_calls);
    previousMessage.tool_calls = [...previousToolCalls, ...currentToolCalls];
    previousMessage.toolTimeline = mergeToolTimelines(
      previousMessage.toolTimeline,
      currentMessage.toolTimeline,
    );
    previousMessage.activityTimeline = mergeActivityTimelines(
      previousMessage.activityTimeline,
      currentMessage.activityTimeline,
    );
    previousMessage.hasThinkingDetails =
      previousMessage.hasThinkingDetails === true || currentMessage.hasThinkingDetails === true;
    previousMessage.thinkingDetailCount = Math.max(
      Number(previousMessage?.thinkingDetailCount || 0),
      Number(currentMessage?.thinkingDetailCount || 0),
    );
    Object.assign(previousMessage, mergeMessagePresentationFacets(previousMessage, currentMessage));
    previousMessage.pending = previousMessage.pending === true || currentMessage.pending === true;
    const currentAttachments = normalizeArray(currentMessage?.attachments);
    const previousAttachments = normalizeArray(previousMessage?.attachments);

    if (currentAttachments.length) {
      previousMessage.attachments = mergeAttachments(previousAttachments, currentAttachments);
    }
    const previousTransferEnvelopes = normalizeArray(previousMessage?.transferEnvelopes);
    const currentTransferEnvelopes = getMessageTransferEnvelopes(currentMessage);
    if (currentTransferEnvelopes.length) {
      previousMessage.transferEnvelopes = [
        ...previousTransferEnvelopes,
        ...currentTransferEnvelopes,
      ];
    }
    // transferEnvelopes are the canonical artifact source. Rebuild the
    // render projection after folding so an envelope arriving on a later
    // assistant record cannot be lost from the displayed message.
    previousMessage.attachments = getMessageAttachments(previousMessage);
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
  // A turn may contain hidden tool-call records and a separate visible
  // assistant record. Their artifact envelopes still belong to one turn
  // projection, so expose the canonical envelope set on each assistant view
  // record instead of relying on which record happened to receive the event.
  const turnArtifacts = new Map();
  // Tool records are intentionally excluded from chat rendering, but their
  // completed result artifacts are canonical turn artifacts. Collect from the
  // full canonical stream before role filtering so a live or persisted tool
  // result cannot disappear from the visible assistant projection.
  for (const message of sourceMessages) {
    const key = resolveMessageTurnScopeMergeKey(message);
    if (!key || getMessageRole(message) !== "assistant") continue;
    const envelopes = getMessageTransferEnvelopes(message);
    const attachments = getMessageAttachments(message);
    const existing = turnArtifacts.get(key) || { envelopes: [], attachments: [] };
    turnArtifacts.set(key, {
      envelopes: envelopes.length ? [...existing.envelopes, ...envelopes] : existing.envelopes,
      attachments: attachments.length
        ? mergeAttachments(existing.attachments, attachments)
        : existing.attachments,
    });
  }
  for (const message of mergedMessages) {
    const key = resolveMessageTurnScopeMergeKey(message);
    const artifacts = turnArtifacts.get(key) || { envelopes: [], attachments: [] };
    if (getMessageRole(message) !== "assistant") continue;
    if (artifacts.envelopes.length) {
      message.transferEnvelopes = artifacts.envelopes;
    }
    if (artifacts.attachments.length) {
      message.attachments = mergeAttachments(
        normalizeArray(message.attachments),
        artifacts.attachments,
      );
    }
    message.attachments = getMessageAttachments(message);
  }
  return mergedMessages.filter((message) => message?.chatPresentation !== false);
}

export {
  EXECUTION_LOG_DISPLAY_LIMIT,
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
  createMessageModel,
  getMessageAttachments,
  findVisibleLastMessage,
  isPluginInjectedMessage,
  isWorkflowMessageLike,
};
