/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  assertMessageEventPayload,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";
import { text } from "@noobot/shared/value";

export async function commitMessageEvent({
  userId,
  sessionId,
  turnScopeId,
  executionId = "",
  commandId = "",
  causationId = "",
  correlationId = "",
  producer = { type: "agent", id: "message-runtime" },
  payload = {},
  persistenceContext,
} = {}) {
  const identity = {
    userId: text(userId),
    sessionId: text(sessionId),
    turnScopeId: text(turnScopeId),
  };
  if (!identity.userId || !identity.sessionId || !identity.turnScopeId) {
    throw new TypeError("message event commit requires user, session and Turn identity");
  }
  const domainPayload = Object.freeze({ ...payload });
  assertMessageEventPayload(domainPayload);
  return this.commitAuthorityEvent({
    userId: identity.userId,
    sessionId: identity.sessionId,
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      turnScopeId: identity.turnScopeId,
      executionId: text(executionId),
    },
    causality: {
      commandId: text(commandId),
      causationId: text(causationId),
      correlationId: text(correlationId),
    },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: domainPayload.presentationMessageId,
    },
    producer: { type: text(producer?.type), id: text(producer?.id) },
    payload: domainPayload,
    persistenceContext,
  });
}
