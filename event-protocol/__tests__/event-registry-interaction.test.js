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
  createInteractionAuthority,
  getEventFamily,
  validateInteractionAuthority,
  validateInteractionRequestPayload,
  isPendingInteractionReplay,
  INTERACTION_LIFECYCLE,
  isTerminalInteractionLifecycle,
  createEventEnvelope,
  readProtocolEventPayload,
  readProtocolEventReducerInput,
  validateProtocolEvent,
} from "../src/index.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

test("interaction authority is one strict Session and Turn routing protocol", () => {
  const source = {
    session: {
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: "root-session",
    },
    turn: { dialogProcessId: "child-dialog", turnScopeId: "child-turn" },
    persistenceScope: {
      scopeId: "agent:child-execution",
      parentSessionId: "root-session",
      relativeDir: "runtime/agent/session/child-session",
      allowedRoot: "runtime/agent/session",
    },
  };

  const validation = validateInteractionAuthority(source);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.authority, createInteractionAuthority(source));
  assert.equal(Object.isFrozen(validation.authority), true);
  assert.equal(Object.isFrozen(validation.authority.persistenceScope), true);
});

test("interaction authority rejects alternate shapes and conflicting persistence routing", () => {
  const source = {
    session: {
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: "root-session",
    },
    turn: { dialogProcessId: "child-dialog", turnScopeId: "child-turn" },
    persistenceScope: {
      scopeId: "agent:child-execution",
      parentSessionId: "different-root",
      relativeDir: "runtime/agent/session/child-session",
      allowedRoot: "runtime/agent/session",
      legacyPath: "runtime/legacy",
    },
    sessionId: "legacy-flat-session",
  };

  assert.deepEqual(validateInteractionAuthority(source).errors, [
    "unknown_interaction_authority_field",
    "unknown_persistence_scope_field",
    "persistence_scope_parent_mismatch",
  ]);
  assert.deepEqual(
    validateInteractionAuthority({
      session: source.session,
      turn: source.turn,
      persistenceScope: { scopeId: "agent:child-execution" },
    }).errors,
    ["incomplete_persistence_scope", "persistence_scope_parent_mismatch"],
  );
});

test("event family registry delegates authoritative domain events only", () => {
  const interaction = getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST);
  assert.equal(interaction.authority, EVENT_AUTHORITY.AUTHORITATIVE);
  assert.equal(interaction.reducerTarget, EVENT_REDUCER_TARGET.INTERACTION);
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

test("turn lifecycle envelope causality must equal the payload causality", () => {
  const payload = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-causality-1",
    commandId: "command-causality-1",
    causationId: "cause-causality-1",
    correlationId: "turn-causality-1",
    sessionId: "session-causality-1",
    turnScopeId: "turn-causality-1",
    messageId: "message-causality-1",
    presentationMessageId: "presentation-causality-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const envelopeWith = (causality) =>
    createEventEnvelope({
      family: EVENT_FAMILY.TURN_LIFECYCLE,
      identity: {
        eventId: payload.eventId,
        eventType: TURN_LIFECYCLE_WIRE_EVENT,
        sessionId: payload.sessionId,
        turnScopeId: payload.turnScopeId,
        messageId: payload.messageId,
      },
      causality,
      ordering: { domain: "session", scopeId: payload.sessionId, sequence: 2, revision: 2 },
      producer: { type: "test", id: "event-registry" },
      occurredAt: payload.occurredAt,
      payload,
    });
  const exact = {
    commandId: payload.commandId,
    causationId: payload.causationId,
    correlationId: payload.correlationId,
  };

  assert.equal(validateProtocolEvent(envelopeWith(exact)).valid, true);
  assert.deepEqual(validateProtocolEvent(envelopeWith({ ...exact, commandId: "" })).errors, [
    "missing_command_id",
    "lifecycle_commandId_mismatch",
  ]);
  assert.deepEqual(
    validateProtocolEvent(envelopeWith({ ...exact, commandId: "command-other" })).errors,
    ["lifecycle_commandId_mismatch"],
  );
  assert.deepEqual(
    validateProtocolEvent(envelopeWith({ ...exact, causationId: "", correlationId: "x" })).errors,
    ["lifecycle_causationId_mismatch", "lifecycle_correlationId_mismatch"],
  );
});
