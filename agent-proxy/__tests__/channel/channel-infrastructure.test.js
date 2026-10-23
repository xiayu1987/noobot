/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelEventJournal } from "../../src/channel/channel-event-journal.js";
import { CommandRegistry, PENDING_COMMAND_KIND } from "../../src/channel/command-registry.js";
import { ChannelManager } from "../../src/channel/channel-manager.js";
import { initializeDownstreamSocketState } from "../../src/websocket/downstream-socket-state.js";
import { config } from "../../src/shared/config.js";
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleReceipt,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import { normalizeRuntimeEventEnvelope } from "@noobot/runtime-events";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { createChannelKey, parseChannelKey } from "../../src/shared/utils.js";

function canonicalTurnLifecycle(domainEnvelope) {
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    schemaVersion: getEventFamily(EVENT_FAMILY.TURN_LIFECYCLE).schemaVersion,
    identity: {
      eventId: domainEnvelope.eventId,
      eventType: "turn_lifecycle",
      sessionId: domainEnvelope.sessionId,
      turnScopeId: domainEnvelope.turnScopeId,
    },
    causality: { commandId: domainEnvelope.commandId },
    ordering: {
      domain: "session",
      scopeId: domainEnvelope.sessionId,
      sequence: domainEnvelope.sequence,
      revision: domainEnvelope.revision,
    },
    producer: { type: "test", id: "agent-proxy-channel-infrastructure" },
    occurredAt: domainEnvelope.occurredAt,
    payload: domainEnvelope,
  });
}

test("channel event journal is the bounded ordered replay source", () => {
  const journal = new ChannelEventJournal({ maxEvents: 2 });
  journal.append("thinking", { value: 1 });
  journal.append("delta", { value: 2 });
  journal.append("done", { value: 3 });
  assert.deepEqual(
    journal.events.map((event) => event.sequence),
    [2, 3],
  );
  assert.deepEqual(
    journal.after(2).map((event) => event.event),
    ["done"],
  );
});

function createRegistry(overrides = {}) {
  let currentMs = 1000;
  const removals = [];
  const registry = new CommandRegistry({
    now: () => currentMs,
    ttlMs: 100,
    onRemove: (removal) => removals.push(removal),
    maxRemovals: 3,
    ...overrides,
  });
  return { registry, removals, advance: (ms) => (currentMs += ms) };
}

const EXECUTION = { channelKey: "channel-1", kind: PENDING_COMMAND_KIND.EXECUTION_QUERY };

function registerExecution(registry, commandId, socket, channelKey = "channel-1") {
  return registry.register(commandId, {
    channelKey,
    kind: PENDING_COMMAND_KIND.EXECUTION_QUERY,
    socket,
    settle: () => {},
  });
}

test("command registry rejects non-canonical, unknown-kind and duplicate registrations", () => {
  const { registry } = createRegistry();
  const socket = {};
  assert.throws(() => registerExecution(registry, " q-1", socket), TypeError);
  assert.throws(
    () => registry.register("q-1", { channelKey: "channel-1", kind: "other", socket, settle() {} }),
    TypeError,
  );
  registerExecution(registry, "q-1", socket);
  assert.throws(() => registerExecution(registry, "q-1", socket), TypeError);
});

test("command registry take only releases a record matching channel and kind", () => {
  const { registry, removals } = createRegistry();
  const socket = {};
  registerExecution(registry, "q-1", socket);
  assert.equal(registry.take("q-1", { ...EXECUTION, channelKey: "channel-2" }, "delivered"), null);
  assert.equal(
    registry.take("q-1", { ...EXECUTION, kind: PENDING_COMMAND_KIND.TURN_SNAPSHOT }, "delivered"),
    null,
  );
  assert.equal(registry.take("q-1", EXECUTION, "delivered").socket, socket);
  assert.equal(registry.take("q-1", EXECUTION, "delivered"), null);
  assert.deepEqual(
    removals.map(({ commandId, reason }) => [commandId, reason]),
    [["q-1", "delivered"]],
  );
});

test("command registry records why each command was removed", () => {
  const { registry, removals, advance } = createRegistry();
  const socket = {};
  registerExecution(registry, "q-delivered", socket);
  registerExecution(registry, "q-cancelled", socket);
  registerExecution(registry, "q-other", {});
  advance(40);
  registry.take("q-delivered", EXECUTION, "delivered");
  assert.equal(registry.cancelSocket(socket), 1);

  registerExecution(registry, "q-expired", socket, "channel-2");
  registerExecution(registry, "q-missing", socket, "channel-gone");
  advance(100);
  registry.cleanup((key) => key !== "channel-gone");

  assert.deepEqual(
    removals.map(({ commandId, reason }) => [commandId, reason]),
    [
      ["q-delivered", "delivered"],
      ["q-cancelled", "requester_disconnected"],
      ["q-other", "ttl_expired"],
      ["q-expired", "ttl_expired"],
      ["q-missing", "channel_missing"],
    ],
  );
  assert.equal(removals[0].registeredForMs, 40);
  assert.equal(removals[3].registeredForMs, 100);
  assert.equal(registry.lastRemoval("q-expired").reason, "ttl_expired");
  assert.equal(registry.removals.size, 3);
  assert.equal(registry.lastRemoval("q-delivered"), null);
});

test("command registry surfaces removal callback contract failures", () => {
  const { registry } = createRegistry({
    onRemove: () => {
      throw new Error("invalid removal log");
    },
  });
  registerExecution(registry, "q-1", {});
  assert.throws(() => registry.take("q-1", EXECUTION, "delivered"), /invalid removal log/);
});

test("command removal session log events satisfy the runtime event schema", () => {
  const logged = [];
  const manager = new ChannelManager(class {}, {
    sessionLogClient: { log: (apiKey, event) => logged.push({ apiKey, event }) },
  });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "admin", sessionId: "session-1" }),
  );
  channel.apiKey = "key-1";
  logged.length = 0;
  const pending = { channelKey: channel.key, kind: PENDING_COMMAND_KIND.EXECUTION_QUERY };
  for (const id of ["q-delivered", "q-orphaned"]) {
    manager.commandRegistry.register(id, { ...pending, socket: {}, settle: () => {} });
  }
  manager.commandRegistry.take("q-delivered", pending, "delivered");
  manager.commandRegistry.take("q-orphaned", pending, "forward_failed");

  assert.equal(logged.length, 1);
  const record = normalizeRuntimeEventEnvelope({
    source: "agent-proxy",
    ...logged[0].event,
    userId: "admin",
  });
  assert.equal(record.scope, "session");
  assert.equal(record.sessionId, "session-1");
  assert.equal(record.event, "agentProxy.commandRegistry.removed");
  assert.equal(record.category, "transport");
  assert.equal(logged[0].event.data.reason, "forward_failed");
});

function channelStub(sessionId) {
  const key = createChannelKey({ userId: "user-1", sessionId });
  return { key, identity: parseChannelKey(key) };
}

test("subscriber delivery closes a slow consumer at the backpressure boundary", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  let closeReason = "";
  const socket = {
    readyState: 1,
    bufferedAmount: config.wsMaxBufferedBytes + 1,
    close(_code, reason) {
      closeReason = reason;
    },
  };
  const result = manager.sendSocketEvent(socket, {
    event: AGENT_TRANSPORT_EVENT.READY,
    data: {},
  });
  assert.equal(result.reason, "backpressure_limit");
  assert.equal(closeReason, "slow_consumer");
});

test("authoritative lifecycle delivery remains pending until the browser receipt", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { sessionId: "session-1", userId: "user-1" });
  const socket = initializeDownstreamSocketState({
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
  });
  manager.attachSubscriber(channel, socket, { sendStateSnapshot: false });
  const lifecycle = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-1",
    commandId: "command-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    presentationMessageId: "assistant-1",
    dialogProcessId: "dialog-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });

  assert.equal(
    manager.sendChannelEvent(channel, socket, {
      sequence: 7,
      event: "turn_lifecycle",
      data: canonicalTurnLifecycle(lifecycle),
    }).result,
    "sent",
  );
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-1"), true);
  assert.equal(socket.__agentProxyLastSequenceByChannel[channel.key], 0);

  assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-1"), true);
  assert.equal(socket.sent.length, 2);
  const receiptResult = manager.acknowledgeTurnLifecycleDelivery(
    socket,
    createTurnLifecycleReceipt(lifecycle),
  );
  assert.equal(receiptResult.acknowledged, true);
  assert.equal(receiptResult.reason, "");
  assert.equal(receiptResult.receipt.eventId, "event-1");
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-1"), false);
  assert.equal(socket.__agentProxyLastSequenceByChannel[channel.key], 7);
  assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-1"), false);
});

test("newer lifecycle state supersedes the in-flight state and is delivered immediately", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  const channel = channelStub("session-ordered");
  const logged = [];
  manager.logSessionEvent = (_channel, entry) => logged.push(entry);
  const socket = initializeDownstreamSocketState({
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
  });
  const createLifecycle = ({ eventType, eventId, sequence, phase, state }) =>
    createTurnLifecycleEnvelope({
      eventType,
      eventId,
      commandId: "command-ordered",
      sessionId: "session-ordered",
      turnScopeId: "turn-ordered",
      presentationMessageId: "assistant-ordered",
      dialogProcessId: "dialog-ordered",
      revision: sequence,
      sequence,
      phase,
      state,
    });
  const started = createLifecycle({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-ordered-2",
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const completed = createLifecycle({
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    eventId: "event-ordered-3",
    sequence: 3,
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETION_REQUESTING,
  });

  assert.equal(
    manager.sendChannelEvent(channel, socket, {
      sequence: 12,
      event: "turn_lifecycle",
      data: canonicalTurnLifecycle(started),
    }).result,
    "sent",
  );
  assert.equal(
    manager.sendChannelEvent(channel, socket, {
      sequence: 13,
      event: "turn_lifecycle",
      data: canonicalTurnLifecycle(completed),
    }).result,
    "sent",
  );
  assert.deepEqual(
    socket.sent.map((item) => item.data.identity.eventId),
    ["event-ordered-2", "event-ordered-3"],
  );
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-ordered-2"), false);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-ordered-3"), true);
  const superseded = logged.find(
    (entry) => entry.event === "agentProxy.channel.lifecycle.superseded",
  );
  assert.equal(superseded?.data?.supersededEventId, "event-ordered-2");
  assert.equal(superseded?.data?.eventId, "event-ordered-3");

  const staleReceipt = manager.acknowledgeTurnLifecycleDelivery(
    socket,
    createTurnLifecycleReceipt(started),
  );
  assert.equal(staleReceipt.acknowledged, false);
  const receipt = manager.acknowledgeTurnLifecycleDelivery(
    socket,
    createTurnLifecycleReceipt(completed),
  );
  assert.equal(receipt.acknowledged, true);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.size, 0);
  assert.equal(socket.__agentProxyLifecycleDeliveriesByTurn.size, 0);
});

test("older lifecycle state is superseded by the in-flight newer state and not sent", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  const channel = channelStub("session-stale");
  const socket = initializeDownstreamSocketState({
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
  });
  const base = {
    commandId: "command-stale",
    sessionId: "session-stale",
    turnScopeId: "turn-stale",
    presentationMessageId: "assistant-stale",
    dialogProcessId: "dialog-stale",
  };
  const completed = createTurnLifecycleEnvelope({
    ...base,
    eventType: TURN_EVENT.COMPLETED,
    eventId: "event-stale-completed",
    revision: 4,
    sequence: 4,
    summaryVersion: 1,
    completionCommitId: "completion-stale",
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETED,
  });
  const processing = createTurnLifecycleEnvelope({
    ...base,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-stale-processing",
    revision: 3,
    sequence: 3,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  assert.equal(
    manager.sendChannelEvent(channel, socket, {
      sequence: 31,
      event: "turn_lifecycle",
      data: canonicalTurnLifecycle(completed),
    }).result,
    "sent",
  );
  const stale = manager.sendChannelEvent(channel, socket, {
    sequence: 30,
    event: "turn_lifecycle",
    data: canonicalTurnLifecycle(processing),
  });
  assert.deepEqual(stale, { result: "superseded", reason: "newer_lifecycle_in_flight" });
  assert.deepEqual(
    socket.sent.map((item) => item.data.identity.eventId),
    ["event-stale-completed"],
  );
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-stale-processing"), false);
});

test("detaching a subscriber clears lifecycle receipt timers", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  let timerCleared = false;
  const socket = initializeDownstreamSocketState({});
  socket.__agentProxyPendingLifecycleDeliveries.set("event-1", {
    timer: { [Symbol.toPrimitive]: () => 1 },
  });
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = () => {
    timerCleared = true;
  };
  try {
    manager.detachSocketFromAllChannels(socket);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(timerCleared, true);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.size, 0);
});

test("unacknowledged lifecycle exhausts retries and retires the unreliable socket", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = channelStub("session-timeout");
  const closeCalls = [];
  const socket = initializeDownstreamSocketState({
    readyState: 1,
    bufferedAmount: 0,
    send() {},
    close(code, reason) {
      closeCalls.push({ code, reason });
    },
  });
  const lifecycle = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.COMPLETED,
    eventId: "event-timeout",
    commandId: "command-timeout",
    sessionId: "session-timeout",
    turnScopeId: "turn-timeout",
    presentationMessageId: "assistant-timeout",
    dialogProcessId: "dialog-timeout",
    revision: 4,
    sequence: 4,
    summaryVersion: 1,
    completionCommitId: "completion-timeout",
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETED,
  });
  manager.sendChannelEvent(channel, socket, {
    sequence: 11,
    event: "turn_lifecycle",
    data: canonicalTurnLifecycle(lifecycle),
  });

  for (let attempt = 1; attempt < config.turnLifecycleDeliveryMaxAttempts; attempt += 1) {
    assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-timeout"), true);
  }
  assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-timeout"), false);
  assert.deepEqual(closeCalls, [{ code: 1011, reason: "lifecycle_receipt_timeout" }]);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.size, 0);
});

test("terminal lifecycle supersedes an unacknowledged state instead of waiting behind it", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = channelStub("session-drop");
  const logged = [];
  manager.logSessionEvent = (_channel, entry) => logged.push(entry);
  const closeCalls = [];
  const socket = initializeDownstreamSocketState({
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) {
      this.sent.push(JSON.parse(raw));
    },
    close(code, reason) {
      closeCalls.push({ code, reason });
    },
  });
  const base = {
    commandId: "command-drop",
    sessionId: "session-drop",
    turnScopeId: "turn-drop",
    presentationMessageId: "assistant-drop",
    dialogProcessId: "dialog-drop",
  };
  const processing = createTurnLifecycleEnvelope({
    ...base,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-drop-processing",
    revision: 3,
    sequence: 3,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
  const completed = createTurnLifecycleEnvelope({
    ...base,
    eventType: TURN_EVENT.COMPLETED,
    eventId: "event-drop-completed",
    revision: 4,
    sequence: 4,
    summaryVersion: 1,
    completionCommitId: "completion-drop",
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETED,
  });
  manager.sendChannelEvent(channel, socket, {
    sequence: 21,
    event: "turn_lifecycle",
    data: canonicalTurnLifecycle(processing),
  });
  const terminal = manager.sendChannelEvent(channel, socket, {
    sequence: 22,
    event: "turn_lifecycle",
    data: canonicalTurnLifecycle(completed),
  });
  assert.equal(terminal.result, "sent");
  assert.deepEqual(
    socket.sent.map((item) => item.data.identity.eventId),
    ["event-drop-processing", "event-drop-completed"],
  );

  assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-drop-processing"), false);

  for (let attempt = 1; attempt <= config.turnLifecycleDeliveryMaxAttempts; attempt += 1) {
    manager._retryPendingLifecycleDelivery(socket, "event-drop-completed");
  }
  const exhausted = logged.find(
    (entry) => entry.event === "agentProxy.channel.lifecycleReceipt.exhausted",
  );
  assert.equal(exhausted?.data?.eventId, "event-drop-completed");
  assert.equal("droppedDeliveries" in (exhausted?.data || {}), false);
  assert.deepEqual(closeCalls, [{ code: 1011, reason: "lifecycle_receipt_timeout" }]);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.size, 0);
  assert.equal(socket.__agentProxyLifecycleDeliveriesByTurn.size, 0);
});
