/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveAttachmentAccessMeta } from "../../../infrastructure/api/attachments/attachmentAccess.js";
import { getMessageTransferEnvelopes } from "./transferEnvelopes.js";
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "./messageIdentity.js";
import { getMessageTimestamp, nowIso, nowMs } from "./timeFields.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { initializeMessageEventState } from "./messageEventState.js";
import { getMessageAttachments, normalizeArray } from "./messageAttachmentsProjection.js";
import { findVisibleLastMessage, isPluginInjectedMessage } from "./messageVisibility.js";
import { foldConversationMessages } from "./conversationFolding.js";
import { isWorkflowMessageLike, normalizeWorkflowMeta } from "./messageWorkflowMeta.js";
import {
  buildMessageContentFacet,
  buildMessageModelRunFacet,
  buildMessageOriginFacet,
  buildMessageStatusFacet,
  buildMessageTimelineFacet,
} from "./messageModelFacets.js";

const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

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

function buildMessageIdentityFacet(canonicalMessage = {}) {
  const sessionId = String(
    canonicalMessage?.sessionId || canonicalMessage?.session_id || "",
  ).trim();
  const messageRole = getMessageRole(canonicalMessage) || "assistant";
  const sourceMessageId = String(canonicalMessage?.messageId || canonicalMessage?.id || "").trim();
  const presentationMessageId = String(canonicalMessage?.presentationMessageId || "").trim();
  const messageId =
    messageRole === "assistant" && presentationMessageId ? presentationMessageId : sourceMessageId;
  return {
    id: messageId,
    messageId,
    ...(presentationMessageId ? { presentationMessageId } : {}),
    ...(sourceMessageId && sourceMessageId !== messageId ? { sourceMessageId } : {}),
    turnScopeId: getMessageTurnScopeId(canonicalMessage),
    sessionId,
    session_id: sessionId,
    role: messageRole,
    dialogProcessId: getMessageDialogProcessId(canonicalMessage),
    parentDialogProcessId: getMessageParentDialogProcessId(canonicalMessage),
  };
}

function createMessageModel(messageItem = {}) {
  const canonicalMessage = messageItem;
  const workflowMeta = normalizeWorkflowMeta(canonicalMessage);
  return initializeMessageEventState({
    ...buildMessageIdentityFacet(canonicalMessage),
    ...buildMessageContentFacet(canonicalMessage),
    ...buildMessageModelRunFacet(canonicalMessage),
    ...buildMessageTimelineFacet(canonicalMessage),
    ...buildMessageStatusFacet(canonicalMessage),
    ...buildMessageOriginFacet(canonicalMessage, { workflowMeta }),
    attachments: normalizeArray(getMessageAttachments(canonicalMessage)),
    transferEnvelopes: getMessageTransferEnvelopes(canonicalMessage),
    ts: getMessageTimestamp(canonicalMessage) || nowIso(),
    workflowMessage: isWorkflowMessageLike(canonicalMessage),
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
