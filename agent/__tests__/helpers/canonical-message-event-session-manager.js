/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

export function createCanonicalMessageEventSessionManager({
  producerId = "agent-test-fixture",
  occurredAt = "2026-05-21T00:00:00.000Z",
} = {}) {
  const sequencesByScopeId = new Map();

  return {
    async commitMessageEvent({
      sessionId,
      turnScopeId,
      commandId,
      causationId,
      correlationId,
      producer,
      payload,
    }) {
      const scopeId = payload?.presentationMessageId;
      const sequence = (sequencesByScopeId.get(scopeId) || 0) + 1;
      sequencesByScopeId.set(scopeId, sequence);
      return {
        committed: true,
        envelope: createEventEnvelope({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
          identity: {
            eventId: `${producerId}:${scopeId}:${sequence}`,
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId,
            turnScopeId,
          },
          causality: { commandId, causationId, correlationId },
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId,
            sequence,
          },
          producer,
          occurredAt,
          payload,
        }),
      };
    },
  };
}
