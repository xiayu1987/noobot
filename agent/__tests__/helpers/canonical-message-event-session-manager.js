/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

export function createCanonicalMessageEventSessionManager({
  producerId = "agent-test-fixture",
  occurredAt = "2026-05-21T00:00:00.000Z",
} = {}) {
  const sequencesByMessageId = new Map();

  return {
    async commitMessageEvent({
      sessionId,
      turnScopeId,
      messageId,
      commandId,
      causationId,
      correlationId,
      payload,
    }) {
      const sequence = (sequencesByMessageId.get(messageId) || 0) + 1;
      sequencesByMessageId.set(messageId, sequence);
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          identity: {
            eventId: `${producerId}:${messageId}:${sequence}`,
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId,
            turnScopeId,
            messageId,
          },
          causality: { commandId, causationId, correlationId },
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId: messageId,
            sequence,
          },
          producer: { type: "test", id: producerId },
          occurredAt,
          payload,
        }),
      };
    },
  };
}
