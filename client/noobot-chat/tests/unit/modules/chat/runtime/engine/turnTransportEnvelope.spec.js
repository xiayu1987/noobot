/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { normalizeTurnTransportEnvelope } from "../../../../../../src/modules/chat/runtime/engine/turnTransportEnvelope.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  getEventFamily,
  createTurnLifecycleEventEnvelope,
} from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import { AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND } from "@noobot/agent-transport-protocol";

const committedReceipt = () => ({
  sessionId: "session-1",
  aggregateVersion: 1,
  dialogProcessId: "dialog-1",
  turnScopeId: "client-turn:1",
  userMessage: {
    messageUid: "sm_1",
    userMessageId: "frontend-user-1",
    role: "user",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "client-turn:1",
    content: "hello",
    attachments: [],
  },
});

describe("turnTransportEnvelope", () => {
  it("admits a protocol-valid session receipt as a classified non-envelope event", () => {
    const receipt = committedReceipt();

    const normalized = normalizeTurnTransportEnvelope({ event: "turn_committed", data: receipt });

    expect(normalized).toMatchObject({
      data: receipt,
      protocolEnvelope: null,
      nonEnvelopeKind: AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.SESSION_RECEIPT,
      rejected: null,
    });
  });

  it("rejects an invalid session receipt at the entry with protocol validation errors", () => {
    const receipt = committedReceipt();
    delete receipt.userMessage;

    const normalized = normalizeTurnTransportEnvelope({ event: "turn_committed", data: receipt });

    expect(normalized.data).toBeNull();
    expect(normalized.nonEnvelopeKind).toBe(
      AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.SESSION_RECEIPT,
    );
    expect(normalized.rejected.errors).toEqual(["user_message_missing"]);
  });

  it("rejects an attachment binding receipt that carries no attachments", () => {
    const normalized = normalizeTurnTransportEnvelope({
      event: "turn_attachments_bound",
      data: committedReceipt(),
    });

    expect(normalized.data).toBeNull();
    expect(normalized.rejected.errors).toEqual(["user_message_attachments_missing"]);
  });

  it("rejects invalid protocol envelopes at the transport entry", () => {
    const envelope = canonicalMessageEvent({
      eventId: "event-1",
      eventType: "model_analysis_delta",
      activityId: "activity-l81",
      activityKind: "main_model_analysis",
      presentationMessageId: "message-1",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      sequence: 7,
      occurredAt: "2026-07-26T00:00:00.000Z",
      text: "result",
    });
    delete envelope.identity.turnScopeId;

    const normalized = normalizeTurnTransportEnvelope({ event: "message_event", data: envelope });

    expect(normalized.protocolEnvelope).toBeNull();
    expect(normalized.data).toBeNull();
    expect(normalized.family).toBe("");
    expect(normalized.rejected.errors).toEqual(["missing_turn_scope_id"]);
  });

  it("rejects a valid envelope delivered under a different wire event", () => {
    const envelope = canonicalMessageEvent({
      eventId: "event-2",
      eventType: "model_analysis_delta",
      activityId: "activity-l103",
      activityKind: "main_model_analysis",
      presentationMessageId: "message-1",
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      sequence: 7,
      occurredAt: "2026-07-26T00:00:00.000Z",
      text: "result",
    });

    const normalized = normalizeTurnTransportEnvelope({
      event: TURN_LIFECYCLE_WIRE_EVENT,
      data: envelope,
    });

    expect(normalized.protocolEnvelope).toBeNull();
    expect(normalized.data).toBeNull();
    expect(normalized.rejected.errors).toEqual(["transport_event_type_mismatch"]);
  });

  it("projects one canonical lifecycle payload while retaining its protocol envelope for audit", () => {
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "turn-event-1",
      commandId: "turn-command-1",
      sessionId: "session-1",
      parentSessionId: "",
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
      dialogProcessId: "dp-1",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });
    const protocolEnvelope = createTurnLifecycleEventEnvelope(lifecycle, {
      producer: { type: "test", id: "turn-transport-envelope" },
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
      schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
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
      channelSessionId: "root-session",
    });

    expect(normalized.data).toMatchObject({
      requestId: "request-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    expect(normalized.protocolEnvelope).toBe(protocolEnvelope);
    expect(normalized.channelSessionId).toBe("root-session");
  });
});
