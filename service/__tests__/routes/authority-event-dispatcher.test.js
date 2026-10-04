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

test("authority dispatcher reports ack failure without counting the sent events", async () => {
  const item = createPendingEvent("authority-event-ack-failed", "s-ack-failed");
  const bot = {
    async getPendingAuthorityEvents() {
      return { found: true, events: [item] };
    },
    async recordAuthorityEventAttempts() {
      return { recorded: true };
    },
    async acknowledgeAuthorityEvents() {
      return { acknowledged: false, reason: "ack_rejected" };
    },
  };
  const sent = [];
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => bot,
    sendEvent: (eventType) => sent.push(eventType) > 0,
  });

  const result = await dispatch({ userId: "u1", sessionId: "s-ack-failed" });

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
    async getPendingAuthorityEvents() {
      getCalls += 1;
      if (getCalls === 1) await firstGetGate;
      return { found: true, events: pending };
    },
    async recordAuthorityEventAttempts() {
      return { recorded: true };
    },
    async acknowledgeAuthorityEvents({ acknowledgements = [] }) {
      const ackedIds = new Set(acknowledgements.map((receipt) => receipt.eventId));
      pending = pending.filter((entry) => !ackedIds.has(entry.eventId));
      return { acknowledged: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    resolveBot: () => bot,
    sendEvent: () => true,
  });

  const first = dispatch({ userId: "u1", sessionId: "s-dirty" });
  const second = dispatch({ userId: "u1", sessionId: "s-dirty" });
  assert.equal(second, first);
  releaseFirstGet();

  assert.deepEqual(await first, { dispatched: true, delivered: 1 });
  assert.equal(getCalls, 3);

  const next = dispatch({ userId: "u1", sessionId: "s-dirty" });
  assert.notEqual(next, first);
  assert.deepEqual(await next, { dispatched: true, delivered: 0 });
});
