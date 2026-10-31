/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { mergeAttachments } from "../../model/dialogProcessChain.js";
import {
  findMessageIdentityIndex,
  getMessageRole,
  getMessageSessionId,
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../model/messageIdentity.js";
import { getMessageAttachments as resolveRenderableMessageAttachments } from "../../model/messageModel.js";
import { SESSION_RUN_MESSAGE_RUNTIME_MARK } from "../../runtime/sessionRunStateMachine.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { resolveParsedResultRelation } from "../../../../infrastructure/api/attachments/attachmentAccess.js";
import { selectToolLinkSnapshots } from "../../runtime/engine/toolTimeline.js";
import { isPlainObject, text } from "@noobot/shared/value";

function getMessageAttachments(messageItem = {}) {
  return resolveRenderableMessageAttachments(messageItem);
}

function trim(value = "") {
  return text(value);
}

function getMessageScopeIdentity(messageItem = {}) {
  return {
    sessionId: getMessageSessionId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
  };
}

function getAttachmentOwnership(attachmentItem = {}) {
  const owner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const turnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : {};
  const ownershipSource = owner || turnScope;
  const normalized = normalizeTurnMeta(ownershipSource);
  return {
    ...normalized,
    sessionId: trim(
      normalized.sessionId ||
        ownershipSource?.sessionId ||
        turnScope?.sessionId ||
        attachmentItem?.sessionId,
    ),
  };
}

function hasExplicitAttachmentOwnership(attachmentItem = {}) {
  const ownership = getAttachmentOwnership(attachmentItem);
  return Boolean(ownership.turnScopeId);
}

function isAttachmentOwnedByMessage(attachmentItem = {}, messageItem = {}) {
  if (!hasExplicitAttachmentOwnership(attachmentItem)) return true;
  const attachmentOwnership = getAttachmentOwnership(attachmentItem);
  const messageIdentity = getMessageScopeIdentity(messageItem);

  if (attachmentOwnership.turnScopeId) {
    const sameTurnScope = Boolean(
      messageIdentity.turnScopeId &&
      attachmentOwnership.turnScopeId === messageIdentity.turnScopeId,
    );
    if (!sameTurnScope) return false;
    if (attachmentOwnership.sessionId && messageIdentity.sessionId) {
      return attachmentOwnership.sessionId === messageIdentity.sessionId;
    }
    return true;
  }
  return true;
}

function filterAttachmentsForMessage(attachments = [], messageItem = {}) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachmentItem) =>
    isAttachmentOwnedByMessage(attachmentItem, messageItem),
  );
}

function isFreshPendingAssistant(messageItem = {}) {
  return (
    getMessageRole(messageItem) === "assistant" &&
    messageItem?.pending === true &&
    messageItem?.hasFirstStreamEvent !== true
  );
}

function logDisplayedAttachmentsSummary({
  messageItem = {},
  displayedAttachmentsCount = 0,
  freshPendingAssistant = false,
} = {}) {
  logStateMachineDebug("messageFiles.attachments.displayed", () => ({
    sessionId: getMessageSessionId(messageItem),
    dialogProcessId: getMessageDialogProcessId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    pending: messageItem?.pending === true,
    channelState: messageItem?.channelState?.state || "",
    hasRuntimeMark: Boolean(
      messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || messageItem?.runtimeMark,
    ),
    displayedAttachmentsCount,
    isFreshPendingAssistant: freshPendingAssistant,
  }));
}

function precedingAssistantMessages(allMessages, messageItem) {
  const position = findMessageIdentityIndex(messageItem, allMessages);
  if (position < 0) {
    throw new Error("message_not_in_session_messages");
  }
  return allMessages
    .slice(0, position)
    .filter((candidate) => getMessageRole(candidate) === "assistant");
}

export function collectSessionAttachments(allMessages, messageItem, displayedAttachments) {
  return mergeAttachments(
    precedingAssistantMessages(allMessages, messageItem).flatMap((candidate) =>
      getMessageAttachments(candidate),
    ),
    displayedAttachments,
  );
}

export function sessionMessageIndex(allMessages, messageItem) {
  const position = findMessageIdentityIndex(messageItem, allMessages);
  if (position < 0) throw new Error("message_not_in_session_messages");
  return position;
}

export function collectSessionLinkSnapshots(allMessages) {
  return allMessages.flatMap((candidate, messageIndex) =>
    getMessageRole(candidate) === "assistant"
      ? selectToolLinkSnapshots(candidate, messageIndex)
      : [],
  );
}

function isSameTurnSiblingAssistant(candidate, messageItem, sessionId, turnScopeId) {
  return (
    candidate !== messageItem &&
    getMessageRole(candidate) === "assistant" &&
    getMessageSessionId(candidate) === sessionId &&
    getMessageTurnScopeId(candidate) === turnScopeId
  );
}

export function useMessageFiles({ getMessageItem, getAllMessages }) {
  const displayedAttachments = computed(() => {
    const messageItem = getMessageItem();
    const sessionId = getMessageSessionId(messageItem);
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const sameTurnMessages =
      getMessageRole(messageItem) === "assistant" && sessionId && turnScopeId
        ? getAllMessages().filter((candidate) =>
            isSameTurnSiblingAssistant(candidate, messageItem, sessionId, turnScopeId),
          )
        : [];
    const turnAttachments = sameTurnMessages.reduce(
      (result, candidate) => mergeAttachments(result, getMessageAttachments(candidate)),
      [],
    );
    const sourceAttachments = filterAttachmentsForMessage(
      turnAttachments.length
        ? mergeAttachments(getMessageAttachments(messageItem), turnAttachments)
        : getMessageAttachments(messageItem),
      messageItem,
    );
    const freshPendingAssistant = isFreshPendingAssistant(messageItem);
    logWorkflowDiagnostics("frontend.workflowRender.displayedAttachmentsProjected", () => ({
      ...getMessageScopeIdentity(messageItem),
      role: getMessageRole(messageItem),
      attachments: sourceAttachments.map((attachment) => ({
        attachmentId: text(attachment?.attachmentId),
        clientAttachmentId: text(attachment?.clientAttachmentId),
        sessionId: text(attachment?.sessionId),
        attachmentSource: text(attachment?.attachmentSource),
        parsedResultTargetIdentity: resolveParsedResultRelation(attachment)?.targetIdentity || null,
      })),
    }));
    logDisplayedAttachmentsSummary({
      messageItem,
      displayedAttachmentsCount: sourceAttachments.length,
      freshPendingAssistant,
    });
    return sourceAttachments;
  });

  return {
    displayedAttachments,
  };
}
