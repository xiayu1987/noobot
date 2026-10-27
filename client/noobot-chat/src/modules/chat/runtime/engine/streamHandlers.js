/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { getMessageRole } from "../../model/messageIdentity.js";
import {
  attachmentIdentityKey,
  ATTACHMENT_EVENT_TYPE,
  createAttachmentLifecycleEvent,
  projectAttachmentIdentity,
  reduceAttachmentLifecycle,
} from "@noobot/attachment-protocol";
import { reduceInteractionRequest } from "../interactionPayload.js";
import { text } from "@noobot/shared/value";

function canonicalAttachmentProjectionKey(attachment = {}) {
  const attachmentId = text(attachment?.attachmentId);
  const sessionId = text(attachment?.sessionId);
  const attachmentSource = text(attachment?.attachmentSource).toLowerCase();
  if (attachmentId && sessionId && attachmentSource) {
    return `canonical:${attachmentIdentityKey(projectAttachmentIdentity(attachment))}`;
  }
  return "";
}

export function handleAttachmentLifecycleStreamEvent({
  data,
  activeSession,
  makeViewAttachments,
  logSessionEvent,
}) {
  const event = createAttachmentLifecycleEvent(data);
  if (event.eventType !== ATTACHMENT_EVENT_TYPE.PARSED || !activeSession.value) return;
  logSessionEvent({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: "frontend.attachmentParsed.received",
    sessionId: event.identity.sessionId,
    dialogProcessId: text(data?.dialogProcessId),
    turnScopeId: text(event.turnScopeId),
    data: { incomingCount: 1 },
  });
  const eventKey = canonicalAttachmentProjectionKey(event.identity);
  const { messages } = activeSession.value;
  let matchedCount = 0;
  for (const message of messages) {
    if (getMessageRole(message) !== "user" || !Array.isArray(message?.attachments)) continue;
    const nextAttachments = message.attachments.map((existing) => {
      const canonicalKey = canonicalAttachmentProjectionKey(existing);
      if (canonicalKey !== eventKey) return existing;
      matchedCount += 1;
      const lifecycle = reduceAttachmentLifecycle(existing.attachmentLifecycle, event);
      const updated = {
        ...existing,
        attachmentLifecycle: lifecycle,
        relations: lifecycle.relations,
      };
      return makeViewAttachments([updated])[0];
    });
    message.attachments.splice(0, message.attachments.length, ...nextAttachments);
  }
  logSessionEvent({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: "frontend.attachmentParsed.projected",
    sessionId: text(activeSession.value.sessionId),
    dialogProcessId: text(data?.dialogProcessId),
    turnScopeId: text(data?.turnScopeId),
    data: {
      incomingCount: 1,
      messageCount: messages.length,
      matchedCount,
      userMessageCount: messages.filter((message) => getMessageRole(message) === "user").length,
    },
  });
}

export function handleInteractionRequestStreamEvent({
  data,
  channelSessionId,
  clearMissingInteractionPayloadTimer,
  navigateOnFirstResponseOnce,
  setPendingInteractionRequest,
  clearPendingInteraction,
}) {
  const request = reduceInteractionRequest(data, {
    channelSessionId,
    setPendingInteractionRequest,
    clearPendingInteraction,
  });
  clearMissingInteractionPayloadTimer({
    sessionId: request.sessionId,
    turnScopeId: request.turnScopeId,
  });
  navigateOnFirstResponseOnce?.();
  return true;
}

export function handleBasicStreamEvent(event, context = {}) {
  if (event === StreamEventEnum.ATTACHMENT_LIFECYCLE) {
    handleAttachmentLifecycleStreamEvent(context);
    return true;
  }
  return false;
}
