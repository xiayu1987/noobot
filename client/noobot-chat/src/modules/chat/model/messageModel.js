/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveAttachmentAccessMeta } from "../../../infrastructure/api/attachments/attachmentAccess.js";
import { getMessageTransferEnvelopes } from "./transferEnvelopes.js";
import { getMessageTimestamp, nowIso, nowMs } from "./timeFields.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { getMessageAttachments, normalizeArray } from "./messageAttachmentsProjection.js";
import { findVisibleLastMessage, isPluginInjectedMessage } from "./messageVisibility.js";
import { foldConversationMessages } from "./conversationFolding.js";
import { isWorkflowMessageLike } from "./messageWorkflowMeta.js";
import { createMessageEventState } from "./messageEventState.js";
import { isCanonicalText } from "@noobot/shared/value";
import {
  buildMessageContentFacet,
  buildMessageModelRunFacet,
  buildMessageOriginFacet,
  buildMessageStatusFacet,
  buildMessageTimelineFacet,
  pickOwnFields,
} from "./messageModelFacets.js";

const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

const MESSAGE_IDENTITY_FIELDS = Object.freeze([
  "messageUid",
  "presentationMessageId",
  "userMessageId",
  "modelMessageId",
  "turnScopeId",
  "role",
  "dialogProcessId",
  "parentDialogProcessId",
]);

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

function buildMessageIdentityFacet(canonicalMessage) {
  return pickOwnFields(canonicalMessage, MESSAGE_IDENTITY_FIELDS);
}

function createMessageModel(canonicalMessage, sessionId) {
  if (!isCanonicalText(sessionId)) {
    throw new TypeError("message model invariant failed: session_id_missing");
  }
  return {
    ...buildMessageIdentityFacet(canonicalMessage),
    sessionId,
    ...buildMessageContentFacet(canonicalMessage),
    ...buildMessageModelRunFacet(canonicalMessage),
    ...buildMessageTimelineFacet(canonicalMessage),
    ...buildMessageStatusFacet(canonicalMessage),
    ...buildMessageOriginFacet(canonicalMessage),
    messageEventState: createMessageEventState(),
    attachments: normalizeArray(getMessageAttachments(canonicalMessage)),
    transferEnvelopes: getMessageTransferEnvelopes(canonicalMessage),
    ts: getMessageTimestamp(canonicalMessage) || nowIso(),
    workflowMessage: isWorkflowMessageLike(canonicalMessage),
  };
}

function buildAppendMessage({ sessionId, role, content, attachments, options }) {
  return createMessageModel(
    {
      ...options,
      role,
      content,
      type: "message",
      attachments,
      ts: nowMs(),
    },
    sessionId,
  );
}

function normalizeMessageAttachments(attachments, { userId }) {
  return attachments.map((attachmentItem) => normalizeAttachment(attachmentItem, { userId }));
}

function buildViewMessage(messageItem, { sessionId, userId }) {
  return createMessageModel(
    {
      ...messageItem,
      attachments: normalizeMessageAttachments(getMessageAttachments(messageItem), { userId }),
    },
    sessionId,
  );
}

export {
  EXECUTION_LOG_DISPLAY_LIMIT,
  buildAppendMessage,
  buildViewMessage,
  normalizeMessageAttachments,
  foldConversationMessages,
  getMessageAttachments,
  findVisibleLastMessage,
  isPluginInjectedMessage,
  isWorkflowMessageLike,
};
