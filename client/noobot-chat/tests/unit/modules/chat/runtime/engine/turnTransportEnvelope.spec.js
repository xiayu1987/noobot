/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  normalizeTurnTransportEnvelope,
  TURN_TRANSPORT_SEQUENCE_DOMAIN,
} from "../../../../../../src/modules/chat/runtime/engine/turnTransportEnvelope.js";
import { MESSAGE_EVENT_SEQUENCE_DOMAIN } from "@noobot/event-protocol/message-event";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

describe("turnTransportEnvelope", () => {
  it("keeps transport and message-event sequence domains isolated", () => {
    const normalized = normalizeTurnTransportEnvelope({
      event: "message_event",
      source: "reconnect",
      data: {
        ...canonicalMessageEvent({
          eventId: "event-1", eventType: "main_model_content", messageId: "message-1",
          presentationMessageId: "message-1", sessionId: "session-1",
          dialogProcessId: "dialog-1", turnScopeId: "turn-1", sequence: 7,
          occurredAt: "2026-07-26T00:00:00.000Z", text: "result",
        }),
        seq: 85,
      },
    });

    expect(normalized.transportCursor).toEqual({
      sequenceDomain: TURN_TRANSPORT_SEQUENCE_DOMAIN,
      sequence: 85,
      event: "message_event",
    });
    expect(normalized.messageEventCursor).toMatchObject({
      sequenceDomain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      sequenceScopeId: "message-1",
      sequence: 7,
      eventId: "event-1",
    });
    expect(normalized.identity).toEqual({
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    });
  });

  it("does not treat an inner message sequence as a transport cursor", () => {
    const normalized = normalizeTurnTransportEnvelope({
      event: "message_event",
      data: canonicalMessageEvent({
          eventId: "event-2", eventType: "thinking", messageId: "message-2",
          presentationMessageId: "message-2", sessionId: "session-2", sequence: 99,
          occurredAt: "2026-07-26T00:00:00.000Z", text: "thinking",
        }),
    });

    expect(normalized.transportCursor.sequence).toBe(0);
    expect(normalized.messageEventCursor.sequence).toBe(99);
  });

  it("keeps different protocol events distinct at the same transport sequence", () => {
    const channelState = normalizeTurnTransportEnvelope({
      event: "channel_state",
      data: { seq: 85, sessionId: "session-1", turnScopeId: "turn-1" },
    });
    const done = normalizeTurnTransportEnvelope({
      event: "done",
      data: { seq: 85, sessionId: "session-1", turnScopeId: "turn-1" },
    });

    expect(channelState.transportCursor.sequence).toBe(done.transportCursor.sequence);
    expect(channelState.transportCursor.event).toBe("channel_state");
    expect(done.transportCursor.event).toBe("done");
  });

  it("projects one canonical lifecycle payload while retaining its protocol envelope for audit", () => {
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "turn-event-1",
      commandId: "turn-command-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      messageId: "message-1",
      presentationMessageId: "presentation-1",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });
    const protocolEnvelope = createEventEnvelope({
      family: EVENT_FAMILY.TURN_LIFECYCLE,
      identity: {
        eventId: lifecycle.eventId,
        eventType: TURN_LIFECYCLE_WIRE_EVENT,
        sessionId: lifecycle.sessionId,
        turnScopeId: lifecycle.turnScopeId,
        messageId: lifecycle.messageId,
      },
      causality: { commandId: lifecycle.commandId },
      ordering: { domain: "session", scopeId: lifecycle.sessionId, sequence: 2, revision: 2 },
      producer: { type: "test", id: "turn-transport-envelope" },
      occurredAt: lifecycle.occurredAt,
      payload: lifecycle,
    });

    const normalized = normalizeTurnTransportEnvelope({
      event: TURN_LIFECYCLE_WIRE_EVENT,
      data: protocolEnvelope,
    });

    expect(normalized.data).toBe(lifecycle);
    expect(normalized.protocolEnvelope).toBe(protocolEnvelope);
  });

  it("projects interaction identity and payload through the protocol-declared reducer input", () => {
    const protocolEnvelope = createEventEnvelope({
      family: EVENT_FAMILY.INTERACTION_REQUEST,
      identity: {
        eventId: "interaction-event-1",
        eventType: "interaction_request",
        sessionId: "session-1",
        turnScopeId: "turn-1",
      },
      causality: {},
      ordering: { domain: "interaction", scopeId: "request-1", sequence: 1 },
      producer: { type: "test", id: "turn-transport-envelope" },
      occurredAt: "2026-08-18T00:00:00.000Z",
      payload: {
        requestId: "request-1",
        dialogProcessId: "dialog-1",
        content: "confirm",
        lifecycle: "pending",
      },
    });

    const normalized = normalizeTurnTransportEnvelope({
      event: "interaction_request",
      data: protocolEnvelope,
    });

    expect(normalized.data).toMatchObject({
      requestId: "request-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    expect(normalized.protocolEnvelope).toBe(protocolEnvelope);
  });
});
