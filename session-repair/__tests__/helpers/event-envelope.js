/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_PROTOCOL_NAME, EVENT_PROTOCOL_VERSION } from "@noobot/event-protocol/envelope";

export function eventEnvelope(
  { eventId, eventType, sessionId, turnScopeId, sequence },
  overrides = {},
) {
  return {
    protocol: {
      name: EVENT_PROTOCOL_NAME,
      version: EVENT_PROTOCOL_VERSION,
      family: "turn_lifecycle",
      schemaVersion: 1,
    },
    identity: { eventId, eventType, sessionId },
    causality: {},
    ordering: { domain: "turn", scopeId: turnScopeId, sequence },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-10-01T00:00:00.000Z",
    payload: {},
    ...overrides,
  };
}
