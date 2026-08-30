/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_AUTHORITY,
  EVENT_FAMILY,
  EVENT_REDUCER_TARGET,
  getEventFamily,
  getEventFamilyByWireEvent,
  validateInteractionRequestPayload,
  isPendingInteractionReplay,
  INTERACTION_LIFECYCLE,
  isTerminalInteractionLifecycle,
  createEventEnvelope,
  readProtocolEventPayload,
  readProtocolEventReducerInput,
} from "../src/index.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

test("event family registry delegates authoritative domain events only", () => {
  assert.equal(getEventFamilyByWireEvent("turn.completed"), null);
  assert.equal(getEventFamilyByWireEvent("delta"), null);
  assert.equal(getEventFamilyByWireEvent("reconnect_data"), null);
  const interaction = getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST);
  assert.equal(interaction.authority, EVENT_AUTHORITY.AUTHORITATIVE);
  assert.equal(interaction.reducerTarget, EVENT_REDUCER_TARGET.INTERACTION);
  assert.equal(getEventFamilyByWireEvent("interaction_request"), interaction);
});

test("protocol payload reader validates wire identity and returns the canonical domain fact", () => {
  const payload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-1",
    commandId: "command-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId: payload.eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
    },
    causality: { commandId: payload.commandId },
    ordering: { domain: "session", scopeId: payload.sessionId, sequence: 2, revision: 2 },
    producer: { type: "test", id: "event-registry" },
    occurredAt: payload.occurredAt,
    payload,
  });

  assert.equal(
    readProtocolEventPayload(envelope, {
      wireEvent: TURN_LIFECYCLE_WIRE_EVENT,
      family: EVENT_FAMILY.TURN_LIFECYCLE,
    }).payload,
    payload,
  );
  assert.deepEqual(readProtocolEventPayload(envelope, { wireEvent: "message_event" }).errors, [
    "transport_event_identity_mismatch",
  ]);
});

test("event family declares the exact reducer input projection", () => {
  const turnPayload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-reducer-1",
    commandId: "command-reducer-1",
    sessionId: "session-reducer-1",
    turnScopeId: "turn-reducer-1",
    messageId: "message-reducer-1",
    presentationMessageId: "presentation-reducer-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const turnEnvelope = createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId: turnPayload.eventId,
      eventType: TURN_LIFECYCLE_WIRE_EVENT,
      sessionId: turnPayload.sessionId,
      turnScopeId: turnPayload.turnScopeId,
      messageId: turnPayload.messageId,
    },
    causality: { commandId: turnPayload.commandId },
    ordering: { domain: "session", scopeId: turnPayload.sessionId, sequence: 2, revision: 2 },
    producer: { type: "test", id: "event-reducer" },
    occurredAt: turnPayload.occurredAt,
    payload: turnPayload,
  });

  assert.equal(readProtocolEventReducerInput(turnEnvelope).input, turnPayload);
  assert.equal(getEventFamily(EVENT_FAMILY.ATTACHMENT_LIFECYCLE).reducerInput, "payload");
  assert.equal(getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).reducerInput, "identity_payload");
  assert.equal(getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).reducerInput, "envelope");
  assert.equal(getEventFamily(EVENT_FAMILY.WORKFLOW_RUNTIME).reducerInput, "envelope");
});

test("interaction reducer input combines the canonical envelope identity with its payload", () => {
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    identity: {
      eventId: "interaction-event-1",
      eventType: "interaction_request",
      sessionId: "session-authority",
      turnScopeId: "turn-authority",
    },
    causality: {},
    ordering: { domain: "interaction", scopeId: "request-1", sequence: 1 },
    producer: { type: "test", id: "interaction-reducer" },
    occurredAt: "2026-08-18T00:00:00.000Z",
    payload: {
      requestId: "request-1",
      dialogProcessId: "dialog-1",
      content: "confirm",
      lifecycle: "pending",
    },
  });

  assert.deepEqual(readProtocolEventReducerInput(envelope).input, {
    requestId: "request-1",
    dialogProcessId: "dialog-1",
    content: "confirm",
    lifecycle: "pending",
    sessionId: "session-authority",
    turnScopeId: "turn-authority",
  });
});

test("interaction lifecycle is canonical and terminal states require resolvedBy", () => {
  assert.equal(INTERACTION_LIFECYCLE.FAILED, "failed");
  assert.equal(isTerminalInteractionLifecycle("failed"), true);
  assert.equal(isTerminalInteractionLifecycle("pending"), false);
  const base = {
    requestId: "request-1",
    sessionId: "session-1",
    dialogProcessId: "process-1",
    turnScopeId: "turn-1",
    interactionType: "approval",
  };
  assert.equal(validateInteractionRequestPayload({ ...base, lifecycle: "failed" }).valid, false);
  assert.equal(
    validateInteractionRequestPayload({ ...base, lifecycle: "failed", resolvedBy: "system" }).valid,
    true,
  );
});

test("replay interaction records are atomic and complete", () => {
  const valid = {
    identity: { eventType: "interaction_request" },
    payload: {
      requestId: "request-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      interactionType: "approval",
    },
  };
  assert.equal(isPendingInteractionReplay(valid), true);
  assert.equal(
    isPendingInteractionReplay({
      ...valid,
      payload: { ...valid.payload, requestId: "" },
    }),
    false,
  );
  assert.equal(
    isPendingInteractionReplay({ identity: { eventType: "delta" }, payload: valid.payload }),
    false,
  );
  assert.equal(
    isPendingInteractionReplay({
      ...valid,
      payload: { ...valid.payload, lifecycle: "failed", resolvedBy: "system" },
    }),
    false,
  );
});

test("interaction request requires stable identity and a complete payload", () => {
  const base = {
    requestId: "request-1",
    sessionId: "session-1",
    dialogProcessId: "process-1",
    turnScopeId: "turn-1",
    interactionType: "approval",
  };
  assert.equal(validateInteractionRequestPayload(base).valid, true);
  assert.equal(validateInteractionRequestPayload({ ...base, requestId: "" }).valid, false);
  assert.equal(validateInteractionRequestPayload({ ...base, interactionType: "" }).valid, false);
  assert.equal(
    validateInteractionRequestPayload({
      requestId: "request-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
    }).valid,
    false,
  );
  assert.equal(validateInteractionRequestPayload({ ...base, timeoutMs: 0 }).valid, false);
  assert.equal(validateInteractionRequestPayload({ ...base, timeoutMs: 1000 }).valid, true);
});
