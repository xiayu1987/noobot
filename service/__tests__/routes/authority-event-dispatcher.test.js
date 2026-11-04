/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORITY_EVENT_CONSUMER,
  createAuthorityEventDispatcher,
} from "../../ws/chat-websocket/authority-event-dispatcher.js";

import { createTestLifecycleEnvelope } from "./chat-websocket-server.turn-lifecycle.fixtures.js";

function createPendingEvent(eventId, sessionId) {
  const envelope = createTestLifecycleEnvelope({ eventId, sequence: 1, sessionId });
  return { eventId: envelope.identity.eventId, envelope };
}

test("authority dispatcher confirms the sent prefix before propagating a publisher error", async () => {
  const first = createPendingEvent("authority-prefix", "s-prefix");
  const second = createPendingEvent("authority-retry", "s-prefix");
  let pending = [first, second];
  const failure = new Error("publisher unavailable");
  const sent = [];
  const bot = {
    session: {
      async getPendingAuthorityEvents() {
        return { found: true, events: pending };
      },
      async recordAuthorityEventAttempts() {
        return { recorded: true };
      },
      async acknowledgeAuthorityEvents({ acknowledgements }) {
        const ids = new Set(acknowledgements.map((item) => item.eventId));
        pending = pending.filter((item) => !ids.has(item.eventId));
        return { acknowledged: true };
      },
      async compactAuthorityEvents() {},
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => bot,
    sendEvent: async (_type, envelope) => {
      if (envelope.identity.eventId === second.eventId) throw failure;
      sent.push(envelope.identity.eventId);
      return true;
    },
  });
  const payload = { userId: "u1", sessionId: "s-prefix", persistenceScope: null };
  await assert.rejects(dispatch(payload), (error) => error === failure);
  assert.deepEqual(pending, [second]);
  const result = await dispatch(payload, async (_type, envelope) => {
    sent.push(envelope.identity.eventId);
    return true;
  });
  assert.deepEqual(result, { dispatched: true, delivered: 1 });
  assert.deepEqual(sent, [first.eventId, second.eventId]);
  assert.deepEqual(pending, []);
});

test("authority dispatcher retains both publisher and acknowledgement failures", async () => {
  const events = [createPendingEvent("prefix", "s-both"), createPendingEvent("retry", "s-both")];
  const failure = new Error("publisher failed");
  const acknowledgementFailure = new Error("acknowledgement storage failed");
  let throwAcknowledgement = false;
  let acknowledgedIds;
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => ({
      session: {
        async getPendingAuthorityEvents() {
          return { found: true, events };
        },
        async recordAuthorityEventAttempts() {
          return { recorded: true };
        },
        async acknowledgeAuthorityEvents({ acknowledgements }) {
          acknowledgedIds = acknowledgements.map((item) => item.eventId);
          if (throwAcknowledgement) throw acknowledgementFailure;
          return { acknowledged: false, reason: "session_save_failed" };
        },
      },
    }),
    sendEvent: (_type, envelope) => {
      if (envelope.identity.eventId === "retry") throw failure;
      return true;
    },
  });
  await assert.rejects(
    dispatch({ userId: "u1", sessionId: "s-both", persistenceScope: null }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], failure);
      assert.equal(error.errors[1].message, "session_save_failed");
      return true;
    },
  );
  assert.deepEqual(acknowledgedIds, ["prefix"]);
  throwAcknowledgement = true;
  await assert.rejects(
    dispatch({ userId: "u1", sessionId: "s-both", persistenceScope: null }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, acknowledgementFailure]);
      return true;
    },
  );
});

test("authority dispatcher reports ack failure without counting the sent events", async () => {
  const item = createPendingEvent("authority-event-ack-failed", "s-ack-failed");
  const bot = {
    session: {
      async getPendingAuthorityEvents() {
        return { found: true, events: [item] };
      },
      async recordAuthorityEventAttempts() {
        return { recorded: true };
      },
      async acknowledgeAuthorityEvents() {
        return { acknowledged: false, reason: "ack_rejected" };
      },
    },
  };
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => bot,
    sendEvent: (eventType) => sent.push(eventType) > 0,
  });

  const result = await dispatch({
    userId: "u1",
    sessionId: "s-ack-failed",
    persistenceScope: null,
  });

  assert.deepEqual(result, { dispatched: false, reason: "ack_rejected", delivered: 0 });
  assert.equal(sent.length, 1);
});

test("authority dispatcher drains again when dispatch is requested while a drain is in flight", async () => {
  const item = createPendingEvent("authority-event-dirty", "s-dirty");
  let pending = [item];
  let getCalls = 0;
  let releaseFirstGet;
  const firstGetGate = new Promise((resolve) => {
    releaseFirstGet = resolve;
  });
  const bot = {
    session: {
      async getPendingAuthorityEvents() {
        getCalls += 1;
        if (getCalls === 1) await firstGetGate;
        return { found: true, events: pending };
      },
      async recordAuthorityEventAttempts() {
        return { recorded: true };
      },
      async compactAuthorityEvents() {
        return { compacted: false, removed: 0 };
      },
      async acknowledgeAuthorityEvents({ acknowledgements = [] }) {
        const ackedIds = new Set(acknowledgements.map((receipt) => receipt.eventId));
        pending = pending.filter((entry) => !ackedIds.has(entry.eventId));
        return { acknowledged: true };
      },
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => bot,
    sendEvent: () => true,
  });

  const first = dispatch({ userId: "u1", sessionId: "s-dirty", persistenceScope: null });
  const second = dispatch({ userId: "u1", sessionId: "s-dirty", persistenceScope: null });
  assert.equal(second, first);
  releaseFirstGet();

  assert.deepEqual(await first, { dispatched: true, delivered: 1 });
  assert.equal(getCalls, 3);

  const next = dispatch({ userId: "u1", sessionId: "s-dirty", persistenceScope: null });
  assert.notEqual(next, first);
  assert.deepEqual(await next, { dispatched: true, delivered: 0 });
});
