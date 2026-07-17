/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { createMockSocket, getEvent, listEvents } from "./channel-manager.state-consistency.test-helpers.js";

test("interaction_request resolved by one client should be consistent across all clients", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(String(raw || ""));
    },
  };

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-1",
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });

  manager.handleReconnect(clientA, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });
  manager.handleReconnect(clientB, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });

  const beforeResolveA = JSON.stringify(getEvent(clientA, "reconnect_data")?.data || {});
  const beforeResolveB = JSON.stringify(getEvent(clientB, "reconnect_data")?.data || {});
  assert.equal(beforeResolveA.includes("__agentProxyPendingInteraction"), true);
  assert.equal(beforeResolveB.includes("__agentProxyPendingInteraction"), true);

  const forwarded = manager.forwardToUpstream(channel, {
    action: "interaction_response",
    requestId: "req-1",
    response: { confirmed: true },
  });
  assert.equal(forwarded, true, "interaction_response should be forwarded");

  const clientBAfterResolve = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.handleReconnect(clientBAfterResolve, {
    currentSessionId: "session-1",
    lastReceivedSeqMap: { "dp-1": 2 },
  });
  const afterResolve = JSON.stringify(
    getEvent(clientBAfterResolve, "reconnect_data")?.data || {},
  );
  assert.equal(
    afterResolve.includes("__agentProxyPendingInteraction"),
    false,
    "resolved interaction should not be replayed to any client",
  );
});

test("interaction_pending channel_state should carry pendingInteractions snapshot", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-snapshot" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-snapshot",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-a",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    seq: 2,
    content: "first",
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    seq: 3,
    content: "second",
  });

  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.length, 2);
  const latestState = stateEvents.at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.pendingInteraction?.requestId, "req-a");
  assert.deepEqual(
    latestState?.data?.pendingInteractions?.map((item) => item.requestId),
    ["req-a", "req-b"],
  );
  assert.deepEqual(latestState?.data?.pendingRequestIds, ["req-a", "req-b"]);
});

test("resolving one concurrent interaction keeps channel_state interaction_pending for remaining requests", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-concurrent" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-concurrent",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(String(raw || ""));
    },
  };
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-a",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    seq: 2,
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    seq: 3,
  });
  const forwarded = manager.forwardToUpstream(channel, {
    action: "interaction_response",
    requestId: "req-a",
    response: { confirmed: true },
  });

  assert.equal(forwarded, true);
  const latestState = listEvents(client, "channel_state").at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.requestId, "req-a");
  assert.deepEqual(
    latestState?.data?.pendingInteractions?.map((item) => item.requestId),
    ["req-b"],
  );
  assert.equal(channel.pendingInteractionRequests.has("req-a"), false);
  assert.equal(channel.pendingInteractionRequests.has("req-b"), true);
});

test("channel_state snapshot should carry pendingInteraction payload for interaction_pending", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-snapshot",
    sessionId: "session-1",
    dialogProcessId: "dp-snapshot",
    interactionType: "confirm",
    content: "confirm snapshot",
    seq: 8,
  });

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  const interactionPendingState = stateEvents.find(
    (eventItem) => eventItem?.data?.state === "interaction_pending",
  );
  assert.ok(interactionPendingState);
  assert.equal(
    String(interactionPendingState?.data?.pendingInteraction?.requestId || ""),
    "req-snapshot",
  );
  assert.equal(
    String(interactionPendingState?.data?.pendingInteraction?.dialogProcessId || ""),
    "dp-snapshot",
  );
});

test("interaction_response should resolve channel by pending requestId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-resolve" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-resolve",
  });

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-resolve",
    sessionId: "session-resolve",
    dialogProcessId: "dp-resolve",
    seq: 1,
  });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(
    createMockSocket({ apiKey: "api-key-2", userId: "user-1" }),
    {
      action: "interaction_response",
      requestId: "req-resolve",
    },
  );

  assert.equal(resolvedChannel, channel);
});

