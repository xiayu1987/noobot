/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";

function createMockSocket() {
  return {
    readyState: 1,
    sentEvents: [],
    __agentProxyChannelKeys: new Set(),
    __agentProxyApiKey: "api-key-1",
    __agentProxyUserId: "user-1",
    send(raw) {
      this.sentEvents.push(JSON.parse(String(raw || "{}")));
    },
  };
}

function getReconnectDataEvent(socket) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === "reconnect_data");
}

function getReconnectCompleteEvent(socket) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === "reconnect_complete");
}

test("reconnect echoes requestId on data and completion envelopes", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const socket = createMockSocket();

  manager.handleReconnect(socket, {
    currentSessionId: "session-missing",
    requestId: "reconnect-request-1",
  });

  assert.equal(getReconnectDataEvent(socket)?.data?.requestId, "reconnect-request-1");
  assert.equal(getReconnectCompleteEvent(socket)?.data?.requestId, "reconnect-request-1");
});

test("reconnect rejects the removed message cursor protocol", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const socket = createMockSocket();

  await assert.rejects(
    manager.handleReconnect(socket, {
      currentSessionId: "session-1",
      lastReceivedSeqMap: {},
    }),
    /unsupported_reconnect_message_cursor/,
  );
  assert.equal(socket.sentEvents.length, 0);
});

test("reconnect should not replay resolved interaction_request", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-resolved",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    content: "confirm",
    seq: 2,
  });

  channel.pendingInteractionRequests.delete("req-resolved");
  manager.requestChannelMap.delete("req-resolved");

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const pendingInteractions = reconnectDataEvent.data.sessions.flatMap(
    (session) => session.replayBatch.pendingInteractions,
  );
  assert.equal(
    pendingInteractions.some(
      (envelope) =>
        String(envelope?.event || "") === "interaction_request" &&
        String(envelope?.data?.requestId || "") === "req-resolved",
    ),
    false,
  );
});

test("reconnect should replay unresolved interaction_request with pending marker", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-pending",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    content: "confirm",
    seq: 2,
  });

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, {
    currentSessionId: "session-1",
  });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const sessionEntry = reconnectDataEvent.data.sessions.find((entry) => entry.sessionId === "session-1");
  const pendingInteractionEnvelope = sessionEntry?.replayBatch?.pendingInteractions?.find(
    (envelope) => String(envelope?.data?.requestId || envelope?.requestId || "") === "req-pending",
  );
  assert.ok(pendingInteractionEnvelope, "should expose unresolved interaction in replayBatch.pendingInteractions");
  assert.equal(JSON.stringify(reconnectDataEvent.data).includes("__agentProxyPendingInteraction"), false);
});

test("reconnect excludes the data-plane journal even when it reached retention capacity", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (_apiKey, event) => records.push(event) },
  });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  for (let seq = 1; seq <= 2000; seq += 1) {
    manager.pushChannelEvent(channel, "model_context_trace", {
      sessionId: "session-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      seq,
      trace: "x".repeat(1024),
    });
  }

  const socket = createMockSocket();
  socket.__agentProxyChannelKeys.add(channelKey);

  manager.handleReconnect(socket, { currentSessionId: "session-1" });

  const reconnectDataEvent = getReconnectDataEvent(socket);
  assert.ok(reconnectDataEvent, "should send reconnect_data event");
  const sessionEntry = reconnectDataEvent.data.sessions[0];
  assert.equal("dialogProcesses" in sessionEntry, false);
  assert.deepEqual(sessionEntry.replayBatch.events, []);
  assert.equal(JSON.stringify(reconnectDataEvent).includes("model_context_trace"), false);
  assert.ok(getReconnectCompleteEvent(socket), "reconnect must complete without draining the data journal");
  const prepared = records.find(
    (event) => event.event === "agentProxy.reconnect.authorityBatch.prepared",
  );
  assert.equal(prepared?.data?.excludedDataPlaneEventCount, 2000);
  assert.equal(prepared?.data?.lifecycleTailCount, 0);
});
