/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import {
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../model/messageIdentity.js";
import {
  normalizeTrimmedString,
  stripInternalEventPlaceholderLines,
} from "./utils.js";
import {
  normalizeInteractionRequestPayload,
  resolveConnectorStatusPayload,
} from "../interactionPayload.js";
import { BackendChannelState } from "../sessionRunStateMachine.js";
import { mergeAttachments } from "../../model/dialogProcessChain.js";

function markFirstStreamEvent(botMessage) {
  if (!botMessage) return;
  botMessage.hasFirstStreamEvent = true;
}

function notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce }) {
  if (!getMessageDialogProcessId(botMessage)) return;
  locateSendingStartedMessageOnce?.();
}

function resolveFirstResponseNavigator({
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
} = {}) {
  if (typeof navigateOnFirstResponseOnce === "function") return navigateOnFirstResponseOnce;
  if (typeof scrollOnFirstResponseOnce === "function") return scrollOnFirstResponseOnce;
  return () => {};
}

export function handleDeltaStreamEvent({
  data,
  botMessage,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  locateSendingStartedMessageOnce,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  const chunkText = stripInternalEventPlaceholderLines(data?.text || "");
  if (data?.dialogProcessId && !getMessageDialogProcessId(botMessage)) {
    botMessage.dialogProcessId = normalizeTrimmedString(data.dialogProcessId);
  }
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  botMessage.content += chunkText;
  if (chunkText) {
    markFirstStreamEvent(botMessage);
    notifyFirstResponse();
  }
}

export function handleConnectorStatusStreamEvent({
  data,
  activeSession,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
}) {
  const { connectorType, connectorName, status } = resolveConnectorStatusPayload(data);
  if (connectorTypeSet?.has?.(connectorType) && connectorName) {
    upsertConnectedConnectorInPanelState(activeSession.value, {
      connectorType,
      connectorName,
      status,
    });
    refreshSessionConnectorsAsync(activeSession.value?.sessionId || "");
  }
}

export function handleAttachmentsStreamEvent({
  data,
  botMessage,
  mergeAssistantAttachments,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  markFirstStreamEvent(botMessage);
  if (!getMessageTurnScopeId(botMessage)) return;
  mergeAssistantAttachments(botMessage, data?.attachments || []);
  notifyFirstResponse();
}

export function handleAttachmentParsedStreamEvent({
  data,
  activeSession,
  makeViewMessage,
}) {
  const incoming = Array.isArray(data?.attachments) ? data.attachments : [];
  if (!incoming.length || !activeSession?.value) return;
  const normalized = typeof makeViewMessage === "function"
    ? makeViewMessage({ attachments: incoming })?.attachments || incoming
    : incoming;
  const messages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message?.attachments)) continue;
    message.attachments = message.attachments.map((existing) => {
      const matching = normalized.find((attachment) => {
        const attachmentId = normalizeTrimmedString(attachment?.attachmentId || attachment?.id);
        const existingAttachmentId = normalizeTrimmedString(existing?.attachmentId || existing?.id);
        const clientAttachmentId = normalizeTrimmedString(attachment?.clientAttachmentId);
        const existingClientAttachmentId = normalizeTrimmedString(existing?.clientAttachmentId);
        const contentSha256 = normalizeTrimmedString(attachment?.contentSha256);
        const existingContentSha256 = normalizeTrimmedString(existing?.contentSha256);
        return Boolean(
          (attachmentId && attachmentId === existingAttachmentId) ||
          (clientAttachmentId && clientAttachmentId === existingClientAttachmentId) ||
          (contentSha256 && contentSha256 === existingContentSha256)
        );
      });
      if (!matching) return existing;
      return {
        ...existing,
        ...(matching?.parsedResult ? { parsedResult: matching.parsedResult } : {}),
        ...(matching?.parsedResultUrl ? { parsedResultUrl: matching.parsedResultUrl } : {}),
        ...(matching?.parsedResultName ? { parsedResultName: matching.parsedResultName } : {}),
        ...(matching?.parsedResultAttachmentId
          ? { parsedResultAttachmentId: matching.parsedResultAttachmentId }
          : {}),
      };
    });
  }
}

export function handleInteractionRequestStreamEvent({
  data,
  clearMissingInteractionPayloadTimer,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  const normalizedInteractionRequest = normalizeInteractionRequestPayload({
    ...(data || {}),
    interactionType: normalizeTrimmedString(data?.interactionType),
  });
  clearMissingInteractionPayloadTimer({
    sessionId: normalizeTrimmedString(normalizedInteractionRequest?.sessionId),
    dialogProcessId: normalizeTrimmedString(normalizedInteractionRequest?.dialogProcessId),
  });
  notifyFirstResponse();
  if (tryAutoResolveInteraction(normalizedInteractionRequest)) {
    return true;
  }
  setPendingInteractionRequest(normalizedInteractionRequest);
  return true;
}

export function handleDoneStreamEvent({
  data,
  botMessage,
  activeSession,
  activeSessionId,
  clearPendingInteraction,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  locateDoneMessage,
  applyConversationState,
  locateSendingStartedMessageOnce,
  suppressCompletionConversationState,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  clearPendingInteraction();
  markFirstStreamEvent(botMessage);
  botMessage.dialogProcessId = data?.dialogProcessId || getMessageDialogProcessId(botMessage) || "";
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  activeSession.value.loaded = true;
  if (!suppressCompletionConversationState && botMessage?.pending !== false) {
    const turnMeta = normalizeTurnMeta(data);
    applyConversationState?.(
      {
        state: BackendChannelState.COMPLETED,
        sessionId: String(data?.sessionId || activeSession?.value?.sessionId || ""),
        dialogProcessId: String(getMessageDialogProcessId(botMessage) || data?.dialogProcessId || ""),
        turnScopeId: String(getMessageTurnScopeId(botMessage) || turnMeta.turnScopeId || ""),
        sourceEvent: "done",
        updatedAtMs: nowMs(),
      },
      { botMessage },
    );
  }
}

export function handleBasicStreamEvent(event, context = {}) {
  if (event === StreamEventEnum.DELTA) {
    handleDeltaStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.CONNECTOR_STATUS) {
    handleConnectorStatusStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENTS) {
    handleAttachmentsStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENT_PARSED) {
    handleAttachmentParsedStreamEvent(context);
    return true;
  }
  return false;
}
