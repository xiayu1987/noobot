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

describe("turnTransportEnvelope", () => {
  it("keeps transport and message-event sequence domains isolated", () => {
    const normalized = normalizeTurnTransportEnvelope({
      event: "message_event",
      source: "reconnect",
      data: {
        seq: 85,
        event: {
          envelopeKind: "noobot.message_event",
          envelopeVersion: 2,
          eventId: "event-1",
          eventType: "main_model_content",
          messageId: "message-1",
          presentationMessageId: "message-1",
          sequenceDomain: "message-event",
          sequenceScopeId: "message-1",
          sessionId: "session-1",
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
          sequence: 7,
          timestamp: "2026-07-26T00:00:00.000Z",
          text: "result",
        },
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
      sequenceKey: "message-event:message-1",
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
      data: {
        event: {
          envelopeKind: "noobot.message_event",
          envelopeVersion: 2,
          eventId: "event-2",
          eventType: "thinking",
          messageId: "message-2",
          presentationMessageId: "message-2",
          sequenceDomain: "message-event",
          sequenceScopeId: "message-2",
          sessionId: "session-2",
          sequence: 99,
          timestamp: "2026-07-26T00:00:00.000Z",
          text: "thinking",
        },
      },
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
});
