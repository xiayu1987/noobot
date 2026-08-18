/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCommittedTurnLifecycleEnvelope } from "@noobot/authoritative-state/application";
import { createAuthorityEventDispatcher } from "../../ws/chat-websocket/authority-event-dispatcher.js";

test("authority outbox publishes child lifecycle under the persisted child session identity", async () => {
  const envelope = createCommittedTurnLifecycleEnvelope({
    eventId: "child-event",
    event: {
      commandId: "child-command",
      eventType: "turn.processing_started",
      userId: "u1",
      sessionId: "child-session",
      parentSessionId: "parent-session",
      turnScopeId: "child-turn",
    },
    turn: {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      turnScopeId: "child-turn",
      messageId: "child-message",
      presentationMessageId: "child-message",
      dialogProcessId: "child-dialog",
      revision: 2,
      sequence: 2,
      phase: "processing",
      state: "processing",
      action: "send",
      executionState: "sending",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  const identities = [];
  let delivered = false;
  const bot = {
    async getPendingAuthorityEvents(identity) {
      identities.push(identity);
      return {
        found: true,
        events: delivered ? [] : [{ eventId: envelope.identity.eventId, envelope }],
      };
    },
    async recordAuthorityEventAttempt(identity) {
      identities.push(identity);
      return { recorded: identity.eventId === envelope.identity.eventId };
    },
    async acknowledgeAuthorityEvent(identity) {
      identities.push(identity);
      delivered = identity.eventId === envelope.identity.eventId;
      return { acknowledged: delivered };
    },
  };
  const events = [];
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (event, data) => {
      events.push({ event, data });
      return true;
    },
  });

  const result = await dispatchAuthorityEvents({
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "parent-session",
  });

  assert.deepEqual(result, { dispatched: true, delivered: 1 });
  assert.equal(
    identities.every((identity) => identity.sessionId === "child-session"),
    true,
  );
  assert.equal(
    identities.every((identity) => identity.parentSessionId === "parent-session"),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "turn_lifecycle");
  assert.equal(events[0]?.data?.identity?.sessionId, "child-session");
  assert.equal(events[0]?.data?.identity?.turnScopeId, "child-turn");
  assert.equal(events[0]?.data?.payload?.parentSessionId, "parent-session");
  assert.equal(events[0]?.data?.ordering?.revision, 2);
});

test("authority dispatcher rejects an invalid lifecycle envelope before delivery side effects", async () => {
  const calls = { attempts: 0, sends: 0, acknowledgements: 0 };
  const invalidEnvelope = {
    eventId: "invalid-event",
    eventType: "turn.completed",
    sessionId: "session-invalid",
    // Required stable turn identity and the rest of the lifecycle contract are intentionally absent.
  };
  const bot = {
    async getPendingAuthorityEvents() {
      return {
        found: true,
        events: [{ eventId: invalidEnvelope.eventId, envelope: invalidEnvelope }],
      };
    },
    async recordAuthorityEventAttempt() {
      calls.attempts += 1;
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent() {
      calls.acknowledgements += 1;
      return { acknowledged: true };
    },
  };
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: () => {
      calls.sends += 1;
      return true;
    },
  });

  const result = await dispatchAuthorityEvents({ userId: "user-1", sessionId: "session-invalid" });

  assert.equal(result.dispatched, false);
  assert.equal(result.reason, "invalid_authority_event_envelope");
  assert.deepEqual(calls, { attempts: 0, sends: 0, acknowledgements: 0 });
});
