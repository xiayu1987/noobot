/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateTurnLifecycleRequest, TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { createTurnLifecycleBridge } from "../../ws/chat-websocket/turn-lifecycle-bridge.js";
import { listPendingAuthorityEvents } from "@noobot/event-protocol";
import { createTestLifecycleEnvelope } from "./chat-websocket-server.turn-lifecycle.fixtures.js";
import {
  AUTHORITY_EVENT_CONSUMER,
  createAuthorityEventDispatcher,
} from "../../ws/chat-websocket/authority-event-dispatcher.js";

test("lifecycle bridge preserves invalid identities for protocol rejection without dispatch", async () => {
  const events = [];
  const commit = createTurnLifecycleBridge({
    resolveBot: () => ({
      session: {
        async applyTurnLifecycleEvent({ persistenceScope, ...event }) {
          assert.equal(persistenceScope, null);
          events.push(event);
          return { applied: false, reason: validateTurnLifecycleRequest(event) };
        },
      },
    }),
    dispatchAuthorityEvents: () => assert.fail("rejected input must not dispatch"),
    persistenceScope: null,
  });
  for (const field of ["turnScopeId", "commandId"]) {
    const event = {
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "turn1",
      commandId: "command1",
      causationId: "command1",
      eventType: TURN_EVENT.PROCESSING_STARTED,
      phase: TURN_PHASE.PROCESSING,
      [field]: " invalid ",
    };
    const before = structuredClone(event);
    const result = await commit(event);
    assert.equal(result.applied, false);
    assert.equal(result.reason, "invalid_lifecycle_identity");
    assert.deepEqual(events.at(-1), before);
    assert.deepEqual(event, before);
  }
});

test("authority dispatch rejects noncanonical identity before accessing the session", () => {
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => assert.fail("invalid request must not access the session"),
    sendEvent: () => assert.fail("invalid request must not send"),
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
  });
  for (const field of ["userId", "sessionId"]) {
    assert.throws(() =>
      dispatch({ userId: "u1", sessionId: "s1", persistenceScope: null, [field]: " invalid " }),
    );
  }
  assert.throws(
    () =>
      createAuthorityEventDispatcher({
        resolveBot: () => {},
        sendEvent: () => {},
        consumerId: " service.websocket ",
      }),
    /authority event consumerId is required/,
  );
});

test("authority dispatch stops on outbox record identity conflict before attempts or sends", async () => {
  const envelope = createTestLifecycleEnvelope({ eventId: "event-conflict" });
  const source = [
    { eventId: "conflicting-id", envelope, committedAt: envelope.occurredAt, deliveries: {} },
  ];
  const before = structuredClone(source);
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => ({
      session: {
        async getPendingAuthorityEvents({ consumerId }) {
          return { found: true, events: listPendingAuthorityEvents(source, { consumerId }) };
        },
        recordAuthorityEventAttempts: () => assert.fail("invalid outbox must not record attempts"),
      },
    }),
    sendEvent: () => assert.fail("invalid outbox must not send"),
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
  });
  await assert.rejects(
    dispatch({ userId: "u1", sessionId: "s1", persistenceScope: null }),
    /eventId mismatch/,
  );
  assert.deepEqual(source, before);
});
