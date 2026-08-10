/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { validateAttachmentParsedEvent } from "@noobot/session-protocol";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../model/messageIdentity.js";
import {
  normalizeTrimmedString,
  stripInternalEventPlaceholderLines,
} from "./utils.js";
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import {
  isTerminalInteraction,
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

function canonicalAttachmentProjectionKey(attachment = {}) {
  const attachmentId = String(attachment?.attachmentId || "").trim();
  const sessionId = String(attachment?.sessionId || "").trim();
  const attachmentSource = String(attachment?.attachmentSource || "").trim().toLowerCase();
  if (attachmentId && sessionId && attachmentSource) {
    return `canonical:${attachmentIdentityKey(projectAttachmentIdentity(attachment))}`;
  }
  return "";
}

function draftAttachmentProjectionKey(attachment = {}) {
  const clientAttachmentId = String(
    attachment?.clientAttachmentId || attachment?.draftAttachmentId || "",
  ).trim();
  if (clientAttachmentId) return `draft:${clientAttachmentId}`;
  return "";
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
  logSessionEvent,
}) {
  const incoming = Array.isArray(data?.attachments) ? data.attachments : [];
  const protocolResult = validateAttachmentParsedEvent({
    eventType: StreamEventEnum.ATTACHMENT_PARSED,
    ...(data || {}),
  });
  logSessionEvent?.({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: "frontend.attachmentParsed.received",
    sessionId: String(data?.sessionId || activeSession?.value?.sessionId || "").trim(),
    dialogProcessId: String(data?.dialogProcessId || "").trim(),
    turnScopeId: String(data?.turnScopeId || "").trim(),
    data: { incomingCount: incoming.length },
  });
  if (!protocolResult.valid || !activeSession?.value) return;
  const normalized = typeof makeViewMessage === "function"
    ? makeViewMessage({ attachments: incoming })?.attachments || incoming
    : incoming;
  const normalizedByIdentity = new Map();
  for (const attachment of normalized) {
    const canonicalKey = canonicalAttachmentProjectionKey(attachment);
    const draftKey = draftAttachmentProjectionKey(attachment);
    if (canonicalKey) normalizedByIdentity.set(canonicalKey, attachment);
    if (draftKey) normalizedByIdentity.set(draftKey, attachment);
  }
  const messages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  let matchedCount = 0;
  for (const message of messages) {
    if (getMessageRole(message) !== "user" || !Array.isArray(message?.attachments)) continue;
    const nextAttachments = message.attachments.map((existing) => {
      const canonicalKey = canonicalAttachmentProjectionKey(existing);
      const draftKey = canonicalKey ? "" : draftAttachmentProjectionKey(existing);
      const matching = normalizedByIdentity.get(canonicalKey || draftKey);
      if (!matching) return existing;
      matchedCount += 1;
      return typeof makeViewMessage === "function"
        ? makeViewMessage({ attachments: [{ ...existing, parsedResult: matching.parsedResult }] })?.attachments?.[0]
          || { ...existing, parsedResult: matching.parsedResult }
        : { ...existing, parsedResult: matching.parsedResult };
    });
    message.attachments.splice(0, message.attachments.length, ...nextAttachments);
  }
  logSessionEvent?.({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: "frontend.attachmentParsed.projected",
    sessionId: String(activeSession?.value?.sessionId || "").trim(),
    dialogProcessId: String(data?.dialogProcessId || "").trim(),
    turnScopeId: String(data?.turnScopeId || "").trim(),
    data: {
      incomingCount: incoming.length,
      messageCount: messages.length,
      matchedCount,
      userMessageCount: messages.filter((message) => getMessageRole(message) === "user").length,
    },
  });
}

export function handleInteractionRequestStreamEvent({
  data,
  clearMissingInteractionPayloadTimer,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
  clearPendingInteraction,
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
  if (isTerminalInteraction(normalizedInteractionRequest)) {
    clearPendingInteraction?.(normalizedInteractionRequest);
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
