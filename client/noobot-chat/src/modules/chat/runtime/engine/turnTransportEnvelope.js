/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isMessageEventEnvelope,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  resolveMessageEventSequenceIdentity,
} from "@noobot/event-protocol/message-event";

export const TURN_TRANSPORT_SEQUENCE_DOMAIN = "transport";

const text = (value) => String(value || "").trim();

export function normalizeTurnTransportEnvelope({
  event = "",
  data = {},
  source = "unknown",
} = {}) {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const messageEvent = isMessageEventEnvelope(payload?.event)
    ? payload.event
    : isMessageEventEnvelope(payload?.messageEvent)
      ? payload.messageEvent
      : null;
  // Replay and live transports carry the canonical message envelope under
  // `data.event`. Keep that envelope as the single payload source, while
  // exposing its stable identity through the normalized transport record.
  const normalizedData = messageEvent
    ? {
        ...payload,
        messageEvent,
        sessionId: text(payload?.sessionId || messageEvent.sessionId),
        dialogProcessId: text(payload?.dialogProcessId || messageEvent.dialogProcessId),
        turnScopeId: text(payload?.turnScopeId || messageEvent.turnScopeId),
      }
    : payload;
  return {
    event: text(event),
    data: normalizedData,
    source: text(source) || "unknown",
    identity: {
      sessionId: text(payload?.sessionId || messageEvent?.sessionId),
      dialogProcessId: text(payload?.dialogProcessId || messageEvent?.dialogProcessId),
      turnScopeId: text(payload?.turnScopeId || messageEvent?.turnScopeId),
    },
    transportCursor: {
      sequenceDomain: TURN_TRANSPORT_SEQUENCE_DOMAIN,
      sequence: Number(payload?.seq || payload?.transportSequence || 0),
      event: text(event),
    },
    messageEventCursor: messageEvent
      ? {
          ...resolveMessageEventSequenceIdentity(messageEvent),
          sequenceDomain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
          eventId: text(messageEvent.eventId),
          messageId: text(messageEvent.messageId),
        }
      : null,
  };
}
