/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";
import {
  commitTurnLifecycle,
  createAuthoritativeTurnSnapshot,
} from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_COMMAND,
  TURN_PHASE,
  TURN_STATE,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { recoverTurnFinalize } from "../../ws/chat-websocket/finalize-recovery.js";
import { createTurnLifecycleBridge } from "../../ws/chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createRunEventListener } from "../../ws/chat-websocket/run-event-listener.js";
import {
  attachRunTransport,
  publishRunEvent,
  registerActiveRun,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";
import { EXECUTION_QUERY_COMMAND } from "@noobot/session-protocol/execution-lifecycle";
import {
  startServerWithWs,
  closeServer,
  callChatWs,
  stopChatWs,
  createProtocolTestCommand,
} from "./chat-websocket-server.test-helpers.js";

import {
  createTestLifecycleEnvelope,
  createAuthoritativeBot,
  payload,
  installLifecycleSnapshotReader,
  requestTurnSnapshot,
} from "./chat-websocket-server.turn-lifecycle.fixtures.js";

test("authority dispatcher keeps a failed send pending and reconnect retries the same envelope once", async () => {
  let eventOutbox = [];
  const committed = commitTurnLifecycle({
    lifecycle: {},
    eventOutbox,
    createEventId: () => "authority-event-send-retry",
    event: {
      userId: "u1",
      sessionId: "s-send-retry",
      turnScopeId: "turn-send-retry",
      commandId: "command-send-retry",
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action: "send",
      messageId: "message-send-retry",
      presentationMessageId: "presentation-send-retry",
    },
  });
  assert.equal(committed.applied, true);
  eventOutbox = committed.eventOutbox;

  const sent = [];
  let socketAvailable = false;
  const bot = {
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, {
        eventId,
        attemptedAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({ eventId } = {}) {
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { acknowledged: result.found, reason: result.reason };
    },
  };
  const createDispatcher = () =>
    createAuthorityEventDispatcher({
      resolveBot: () => bot,
      sendEvent: (_eventName, envelope) => {
        if (!socketAvailable) return false;
        sent.push(structuredClone(envelope));
        return true;
      },
    });

  const failed = await createDispatcher()({ userId: "u1", sessionId: "s-send-retry" });
  assert.deepEqual(failed, {
    dispatched: false,
    reason: "authority_event_send_failed",
    delivered: 0,
  });
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 1);
  assert.equal(eventOutbox[0].delivery.attempts, 1);

  socketAvailable = true;
  const retried = await createDispatcher()({ userId: "u1", sessionId: "s-send-retry" });
  assert.deepEqual(retried, { dispatched: true, delivered: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].eventId, "authority-event-send-retry");
  assert.deepEqual(sent[0], committed.envelope);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);

  const afterAcknowledgement = await createDispatcher()({
    userId: "u1",
    sessionId: "s-send-retry",
  });
  assert.deepEqual(afterAcknowledgement, { dispatched: true, delivered: 0 });
  assert.equal(sent.length, 1);
});

test("authority dispatcher preserves the child persistence scope across every outbox operation", async () => {
  const persistenceScope = Object.freeze({
    scopeId: "agent:child-turn",
    parentSessionId: "root-session",
    relativeDir: "runtime/workflow/session/root-session/child-turn",
    allowedRoot: "runtime/workflow/session",
  });
  const calls = [];
  let pending = true;
  const envelope = createTestLifecycleEnvelope({
    eventId: "authority-event-child-context",
    sequence: 9,
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
  });
  const bot = {
    async getPendingAuthorityEvents(input) {
      calls.push({ method: "get", input });
      return { found: true, events: pending ? [{ eventId: envelope.eventId, envelope }] : [] };
    },
    async recordAuthorityEventAttempt(input) {
      calls.push({ method: "attempt", input });
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent(input) {
      calls.push({ method: "acknowledge", input });
      pending = false;
      return { acknowledged: true };
    },
    async compactAuthorityEvents(input) {
      calls.push({ method: "compact", input });
      return { compacted: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: () => true,
  });

  const result = await dispatch({
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
    limit: 25,
  });

  assert.deepEqual(result, { dispatched: true, delivered: 1 });
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["get", "attempt", "acknowledge", "get", "compact"],
  );
  for (const { input } of calls) {
    assert.equal(input.persistenceScope, persistenceScope);
    assert.equal(input.sessionId, "child-session");
    assert.equal(input.parentSessionId, "root-session");
  }
  assert.equal(calls[0].input.limit, 25);
  assert.equal(calls[1].input.eventId, envelope.eventId);
  assert.equal(calls[2].input.eventId, envelope.eventId);
  assert.equal(calls[4].input.deliveredThroughSequence, 9);
  assert.equal(
    Date.now() - Date.parse(calls[4].input.retainDeliveredAfter) >=
      TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
    true,
  );
});

test("a detached child lifecycle commit drains its complete scoped outbox to the root transport", async () => {
  const persistenceScope = Object.freeze({
    scopeId: "agent:workflow-node:child-turn",
    parentSessionId: "root-session",
    relativeDir: "runtime/workflow/session/root-session/child-turn",
    allowedRoot: "runtime/workflow/session",
  });
  const eventTypes = [
    TURN_EVENT.ACTION_ACCEPTED,
    TURN_EVENT.PROCESSING_STARTED,
    TURN_EVENT.PROCESSING_COMPLETED,
    TURN_EVENT.COMPLETED,
  ];
  let pending = eventTypes.map((eventType, index) => {
    const eventId = `child-authority-${index + 1}`;
    return {
      eventId,
      envelope: createTestLifecycleEnvelope({
        eventId,
        eventType,
        sequence: index + 1,
        persistenceScope,
      }),
    };
  });
  const calls = [];
  const sent = [];
  const bot = {
    async getPendingAuthorityEvents(input) {
      calls.push({ method: "get", input });
      return { found: true, events: pending };
    },
    async recordAuthorityEventAttempt(input) {
      calls.push({ method: "attempt", input });
      return { recorded: pending.some((item) => item.eventId === input.eventId) };
    },
    async acknowledgeAuthorityEvent(input) {
      calls.push({ method: "acknowledge", input });
      pending = pending.filter((item) => item.eventId !== input.eventId);
      return { acknowledged: true };
    },
  };
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (event, envelope) => {
      sent.push({ event, envelope });
      return true;
    },
  });
  const listener = createRunEventListener({
    sessionId: "root-session",
    onCommittedTurnLifecycle: (envelope, context) =>
      dispatchAuthorityEvents({
        userId: envelope.userId,
        sessionId: envelope.sessionId,
        parentSessionId: envelope.parentSessionId,
        persistenceScope: context.persistenceScope,
      }),
  });

  const result = await listener.onEvent({
    event: "turn_lifecycle_committed",
    data: { envelope: pending.at(-1).envelope, persistenceScope },
  });

  assert.deepEqual(result, { dispatched: true, delivered: 4 });
  assert.deepEqual(
    sent.map(({ event }) => event),
    eventTypes.map(() => TURN_LIFECYCLE_WIRE_EVENT),
  );
  assert.deepEqual(
    sent.map(({ envelope }) => envelope.eventType),
    eventTypes,
  );
  assert.equal(
    sent.every(({ envelope }) => envelope.sessionId === "child-session"),
    true,
  );
  assert.equal(
    calls.every(
      ({ input }) => JSON.stringify(input.persistenceScope) === JSON.stringify(persistenceScope),
    ),
    true,
  );
  assert.equal(
    sent.every(({ envelope }) => "persistenceScope" in envelope === false),
    true,
  );
  assert.equal(pending.length, 0);
});

test("authority dispatcher serializes concurrent scoped drains and performs the requested confirmation pass", async () => {
  let pending = true;
  let releaseSend;
  const sendBarrier = new Promise((resolve) => {
    releaseSend = resolve;
  });
  const calls = { get: 0, attempt: 0, acknowledge: 0, send: 0 };
  const envelope = createTestLifecycleEnvelope({
    eventId: "authority-event-single-flight",
    sequence: 3,
    sessionId: "child-session",
    parentSessionId: "root-session",
  });
  const bot = {
    async getPendingAuthorityEvents() {
      calls.get += 1;
      return { found: true, events: pending ? [{ eventId: envelope.eventId, envelope }] : [] };
    },
    async recordAuthorityEventAttempt() {
      calls.attempt += 1;
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent() {
      calls.acknowledge += 1;
      pending = false;
      return { acknowledged: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: async () => {
      calls.send += 1;
      await sendBarrier;
      return true;
    },
  });
  const persistenceScope = { scopeId: "agent:child-turn" };
  const payload = {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
  };

  const first = dispatch(payload);
  const second = dispatch(payload);
  assert.equal(first, second);
  releaseSend();
  assert.deepEqual(await Promise.all([first, second]), [
    { dispatched: true, delivered: 1 },
    { dispatched: true, delivered: 1 },
  ]);
  assert.deepEqual(calls, { get: 3, attempt: 1, acknowledge: 1, send: 1 });
});

test("authority dispatcher repeats a scoped drain when a lifecycle commit arrives during its final empty read", async () => {
  let pending = [
    {
      eventId: "authority-event-running",
      envelope: createTestLifecycleEnvelope({
        eventId: "authority-event-running",
        eventType: TURN_EVENT.PROCESSING_STARTED,
        sequence: 1,
      }),
    },
  ];
  let releaseEmptyRead;
  const emptyReadBarrier = new Promise((resolve) => {
    releaseEmptyRead = resolve;
  });
  let emptyReadStarted;
  const emptyReadObserved = new Promise((resolve) => {
    emptyReadStarted = resolve;
  });
  let reads = 0;
  const sent = [];
  const bot = {
    async getPendingAuthorityEvents() {
      reads += 1;
      const events = pending.slice();
      if (reads === 2) {
        emptyReadStarted();
        await emptyReadBarrier;
      }
      return { found: true, events };
    },
    async recordAuthorityEventAttempt({ eventId }) {
      return { recorded: pending.some((item) => item.eventId === eventId) };
    },
    async acknowledgeAuthorityEvent({ eventId }) {
      pending = pending.filter((item) => item.eventId !== eventId);
      return { acknowledged: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (_eventName, envelope) => {
      sent.push(envelope.eventId);
      return true;
    },
  });
  const payload = {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope: { scopeId: "agent:child-turn" },
  };

  const runningDrain = dispatch(payload);
  await emptyReadObserved;
  pending.push({
    eventId: "authority-event-completed",
    envelope: createTestLifecycleEnvelope({
      eventId: "authority-event-completed",
      eventType: TURN_EVENT.COMPLETED,
      sequence: 2,
    }),
  });
  const terminalDrain = dispatch(payload);
  assert.equal(terminalDrain, runningDrain);
  releaseEmptyRead();

  assert.deepEqual(await Promise.all([runningDrain, terminalDrain]), [
    { dispatched: true, delivered: 2 },
    { dispatched: true, delivered: 2 },
  ]);
  assert.deepEqual(sent, ["authority-event-running", "authority-event-completed"]);
  assert.equal(pending.length, 0);
  assert.equal(reads, 4);
});

test("authority dispatcher leaves an event pending when acknowledgement persistence fails", async () => {
  let eventOutbox = [];
  const committed = commitTurnLifecycle({
    lifecycle: {},
    eventOutbox,
    createEventId: () => "authority-event-ack-retry",
    event: {
      userId: "u1",
      sessionId: "s-ack-retry",
      turnScopeId: "turn-ack-retry",
      commandId: "command-ack-retry",
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action: "send",
      messageId: "message-ack-retry",
      presentationMessageId: "presentation-ack-retry",
    },
  });
  assert.equal(committed.applied, true);
  eventOutbox = committed.eventOutbox;

  let acknowledgementAvailable = false;
  const sentEventIds = [];
  const bot = {
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, {
        eventId,
        attemptedAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({ eventId } = {}) {
      if (!acknowledgementAvailable) {
        return { acknowledged: false, reason: "session_save_failed" };
      }
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { acknowledged: result.found, reason: result.reason };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (_eventName, envelope) => {
      sentEventIds.push(envelope.eventId);
      return true;
    },
  });

  const failedAcknowledgement = await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.deepEqual(failedAcknowledgement, {
    dispatched: false,
    reason: "session_save_failed",
    delivered: 0,
  });
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 1);
  assert.equal(eventOutbox[0].delivery.attempts, 1);

  acknowledgementAvailable = true;
  const retry = await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.deepEqual(retry, { dispatched: true, delivered: 1 });
  assert.deepEqual(sentEventIds, ["authority-event-ack-retry", "authority-event-ack-retry"]);
  assert.equal(eventOutbox[0].delivery.attempts, 2);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);

  await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.equal(sentEventIds.length, 2);
});

