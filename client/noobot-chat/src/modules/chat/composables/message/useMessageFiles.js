/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  mergeAttachments,
} from "../../model/dialogProcessChain.js";
import {
  getMessageRole,
  getMessageSessionId,
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
  normalizeTurnMeta,
} from "../../model/messageIdentity.js";
import { getMessageAttachments as resolveRenderableMessageAttachments } from "../../model/messageModel.js";
import {
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../../runtime/sessionRunStateMachine.js";
import { logStateMachineDebug } from "../../../debug/loggers/stateMachineLogger.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";

function getMessageAttachments(messageItem = {}) {
  return resolveRenderableMessageAttachments(messageItem);
}

function trim(value = "") {
  return String(value || "").trim();
}

function getMessageScopeIdentity(messageItem = {}) {
  return {
    sessionId: getMessageSessionId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
        ownershipSource?.session_id ||
        turnScope?.sessionId ||
        turnScope?.session_id ||
        attachmentItem?.sessionId ||
        attachmentItem?.session_id,
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

function isPluginInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    Boolean(String(messageItem?.injectedBy || "").trim())
  );
}

function logDisplayedAttachmentsSummary({
  messageItem = {},
  baseAttachmentsCount = 0,
  toolLogAttachmentsCount = 0,
  displayedAttachmentsCount = 0,
  canUseAssociatedTurnArtifacts = false,
  freshPendingAssistant = false,
} = {}) {
  logStateMachineDebug("messageFiles.attachments.displayed", () => ({
    messageId: messageItem?.id || messageItem?.messageId || "",
    sessionId: getMessageSessionId(messageItem),
    dialogProcessId: getMessageDialogProcessId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    pending: messageItem?.pending === true,
    channelState: messageItem?.channelState?.state || "",
    hasRuntimeMark: Boolean(messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || messageItem?.runtimeMark),
    baseAttachmentsCount,
    toolLogAttachmentsCount,
    displayedAttachmentsCount,
    canUseAssociatedTurnArtifacts,
    isFreshPendingAssistant: freshPendingAssistant,
  }));
}

export function useMessageFiles({
  getMessageItem = () => ({}),
  getAllMessages = () => [],
  getUserId = () => "",
} = {}) {
  const displayedAttachments = computed(() => {
    const messageItem = getMessageItem() || {};
    const sessionId = getMessageSessionId(messageItem);
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const sameTurnMessages = getMessageRole(messageItem) === "assistant" && sessionId && turnScopeId
      ? (Array.isArray(getAllMessages?.()) ? getAllMessages() : [])
      .filter((candidate) =>
        candidate !== messageItem &&
        getMessageRole(candidate) === "assistant" &&
        getMessageSessionId(candidate) === sessionId &&
        getMessageTurnScopeId(candidate) === turnScopeId,
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
    const result = sourceAttachments;
    logWorkflowDiagnostics("frontend.workflowRender.displayedAttachmentsProjected", () => ({
      ...getMessageScopeIdentity(messageItem),
      messageId: String(messageItem?.messageId || messageItem?.id || "").trim(),
      role: getMessageRole(messageItem),
      attachments: result.map((attachment) => ({
        attachmentId: String(attachment?.attachmentId || "").trim(),
        clientAttachmentId: String(attachment?.clientAttachmentId || attachment?.draftAttachmentId || "").trim(),
        sessionId: String(attachment?.sessionId || "").trim(),
        attachmentSource: String(attachment?.attachmentSource || "").trim(),
        hasParsedResult: Boolean(attachment?.parsedResult),
        parsedResultAttachmentId: String(attachment?.parsedResult?.attachmentId || attachment?.parsedResultAttachmentId || "").trim(),
      })),
    }));
    logDisplayedAttachmentsSummary({
      messageItem,
      baseAttachmentsCount: sourceAttachments.length,
      toolLogAttachmentsCount: 0,
      displayedAttachmentsCount: result.length,
      canUseAssociatedTurnArtifacts: false,
      freshPendingAssistant,
    });
    return result;
  });

  return {
    displayedAttachments,
  };
}
