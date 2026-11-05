/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveAttachmentAccessMeta } from "../../../infrastructure/api/attachments/attachmentAccess.js";
import { getMessageTransferEnvelopes } from "./transferEnvelopes.js";
import {
  assertUncommittedMessageDraft,
  requireCommittedMessageTimestamp,
} from "@noobot/session-protocol";
import { getMessageAttachments, normalizeArray } from "./messageAttachmentsProjection.js";
import { findVisibleLastMessage, isPluginInjectedMessage } from "./messageVisibility.js";
import { foldConversationMessages } from "./conversationFolding.js";
import { isWorkflowMessage as isWorkflowMessageLike } from "@noobot/event-protocol/workflow-runtime-event";
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
    workflowMessage: isWorkflowMessageLike(canonicalMessage),
  };
}

function buildAppendMessage({ sessionId, role, content, attachments, options }) {
  const draft = assertUncommittedMessageDraft({
    ...options,
    role,
    content,
    type: "message",
    attachments,
  });
  return createMessageModel(draft, sessionId);
}

function normalizeMessageAttachments(attachments, { userId }) {
  return attachments.map((attachmentItem) => normalizeAttachment(attachmentItem, { userId }));
}

function buildViewMessage(messageItem, { sessionId, userId }) {
  return {
    ...createMessageModel(
      {
        ...messageItem,
        attachments: normalizeMessageAttachments(getMessageAttachments(messageItem), { userId }),
      },
      sessionId,
    ),
    ts: requireCommittedMessageTimestamp(messageItem),
  };
}

export {
  buildAppendMessage,
  buildViewMessage,
  normalizeMessageAttachments,
  foldConversationMessages,
  getMessageAttachments,
  findVisibleLastMessage,
  isPluginInjectedMessage,
  isWorkflowMessageLike,
};
