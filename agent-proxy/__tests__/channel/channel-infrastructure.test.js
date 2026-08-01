/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelEventJournal } from "../../src/channel/channel-event-journal.js";
import { CommandRegistry } from "../../src/channel/command-registry.js";
import { ChannelManager } from "../../src/channel/channel-manager.js";
import { config } from "../../src/shared/config.js";
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleReceipt,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/authoritative-state/contracts";

test("channel event journal is the bounded ordered replay source", () => {
  const journal = new ChannelEventJournal({ maxEvents: 2 });
  journal.append("thinking", { value: 1 });
  journal.append("delta", { value: 2 });
  journal.append("done", { value: 3 });
  assert.deepEqual(journal.events.map((event) => event.sequence), [2, 3]);
  assert.deepEqual(journal.after(2).map((event) => event.event), ["done"]);
});

test("command registry cancels requester commands and expires routes", () => {
  let currentMs = 0;
  const requester = {};
  const registry = new CommandRegistry({ now: () => currentMs, defaultTtlMs: 100 });
  registry.register("snapshot-1", { channelKey: "channel-1", commandType: "turn_snapshot", requester });
  registry.registerRoute("interaction-1", { channelKey: "channel-1" });
  assert.equal(registry.cancelRequester(requester), 1);
  currentMs = 100;
  registry.cleanup({ channelExists: () => true });
  assert.equal(registry.routes.has("interaction-1"), false);
});

test("command registry cancels reconnect snapshot commands by nested socket requester", () => {
  const registry = new CommandRegistry();
  const socket = {};
  let resolution = null;
  registry.register("snapshot-reconnect", {
    channelKey: "channel-1",
    commandType: "turn_snapshot",
    requester: {
      socket,
      resolve: (result) => { resolution = result; },
    },
  });

  assert.equal(registry.cancelRequester(socket), 1);
  assert.deepEqual(resolution, { ok: false, reason: "requester_disconnected" });
  assert.equal(registry.get("snapshot-reconnect"), null);
});

test("subscriber delivery closes a slow consumer at the backpressure boundary", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  let closeReason = "";
  const socket = {
    readyState: 1,
    bufferedAmount: config.wsMaxBufferedBytes + 1,
    close(_code, reason) { closeReason = reason; },
  };
  const result = manager.sendSocketEvent(socket, { event: "delta", data: {} });
  assert.equal(result.reason, "backpressure_limit");
  assert.equal(closeReason, "slow_consumer");
});

test("authoritative lifecycle delivery remains pending until the browser receipt", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  const channel = { key: "user-1:session-1" };
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) { this.sent.push(JSON.parse(raw)); },
  };
  const lifecycle = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId: "event-1",
    commandId: "command-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "assistant-1",
    dialogProcessId: "dialog-1",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });

  assert.equal(manager.sendChannelEvent(channel, socket, {
    sequence: 7,
    event: "turn_lifecycle",
    data: lifecycle,
  }).result, "sent");
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-1"), true);
  assert.equal(socket.__agentProxyLastSequenceByChannel?.[channel.key], undefined);

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

test("authoritative lifecycle delivery is ordered by browser receipts within a turn", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  const channel = { key: "user-1:session-ordered" };
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send(raw) { this.sent.push(JSON.parse(raw)); },
  };
  const createLifecycle = ({ eventType, eventId, sequence, phase, state }) =>
    createTurnLifecycleEnvelope({
      eventType,
      eventId,
      commandId: "command-ordered",
      sessionId: "session-ordered",
      turnScopeId: "turn-ordered",
      messageId: "message-ordered",
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

  assert.equal(manager.sendChannelEvent(channel, socket, {
    sequence: 12,
    event: "turn_lifecycle",
    data: started,
  }).result, "sent");
  assert.equal(manager.sendChannelEvent(channel, socket, {
    sequence: 13,
    event: "turn_lifecycle",
    data: completed,
  }).result, "queued");
  assert.deepEqual(socket.sent.map((item) => item.data.eventId), ["event-ordered-2"]);

  const receipt = manager.acknowledgeTurnLifecycleDelivery(
    socket,
    createTurnLifecycleReceipt(started),
  );
  assert.equal(receipt.acknowledged, true);
  assert.equal(receipt.nextDeliveryResult?.result, "sent");
  assert.deepEqual(socket.sent.map((item) => item.data.eventId), [
    "event-ordered-2",
    "event-ordered-3",
  ]);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.has("event-ordered-3"), true);
});

test("detaching a subscriber clears lifecycle receipt timers", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  let timerCleared = false;
  const socket = {
    __agentProxyChannelKeys: new Set(),
    __agentProxyPendingLifecycleDeliveries: new Map([
      ["event-1", { timer: { [Symbol.toPrimitive]: () => 1 } }],
    ]),
  };
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = () => { timerCleared = true; };
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
  const channel = { key: "user-1:session-timeout" };
  const closeCalls = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send() {},
    close(code, reason) { closeCalls.push({ code, reason }); },
  };
  const lifecycle = createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.COMPLETED,
    eventId: "event-timeout",
    commandId: "command-timeout",
    sessionId: "session-timeout",
    turnScopeId: "turn-timeout",
    messageId: "message-timeout",
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
    data: lifecycle,
  });

  for (let attempt = 1; attempt < config.turnLifecycleDeliveryMaxAttempts; attempt += 1) {
    assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-timeout"), true);
  }
  assert.equal(manager._retryPendingLifecycleDelivery(socket, "event-timeout"), false);
  assert.deepEqual(closeCalls, [{ code: 1011, reason: "lifecycle_receipt_timeout" }]);
  assert.equal(socket.__agentProxyPendingLifecycleDeliveries.size, 0);
});
