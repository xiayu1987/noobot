/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EVENT_FAMILY,
  readProtocolEventReducerInput,
  validateProtocolEvent,
} from "@noobot/event-protocol";

export const TURN_TRANSPORT_SEQUENCE_DOMAIN = "transport";

const text = (value) => String(value || "").trim();

export function normalizeTurnTransportEnvelope({
  event = "",
  data = {},
  source = "unknown",
} = {}) {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const validation = validateProtocolEvent(payload);
  const protocolEnvelope = validation.valid ? payload : null;
  const reducerInput = validation.valid ? readProtocolEventReducerInput(payload).input : null;
  const messageEvent = validation.valid && validation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE
    ? payload
    : null;
  return {
    event: text(event),
    data: reducerInput || payload,
    protocolEnvelope,
    source: text(source) || "unknown",
    identity: {
      sessionId: text(messageEvent?.identity?.sessionId),
      dialogProcessId: text(messageEvent?.payload?.dialogProcessId),
      turnScopeId: text(messageEvent?.identity?.turnScopeId),
    },
    transportCursor: {
      sequenceDomain: TURN_TRANSPORT_SEQUENCE_DOMAIN,
      sequence: Number(payload?.seq || payload?.transportSequence || 0),
      event: text(event),
    },
    messageEventCursor: messageEvent
      ? {
          sequenceDomain: text(messageEvent.ordering.domain),
          sequenceScopeId: text(messageEvent.ordering.scopeId),
          sequence: Number(messageEvent.ordering.sequence),
          eventId: text(messageEvent.identity.eventId),
          messageId: text(messageEvent.identity.messageId),
        }
      : null,
  };
}
