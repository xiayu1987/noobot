/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { createMockSocket, getEvent, listEvents } from "./channel-manager.state-consistency.test-helpers.js";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/authoritative-state/contracts";

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
    turnScopeId: "turn-1",
    seq: 2,
    content: "confirm",
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
  const reconnectState = getEvent(clientBAfterResolve, "reconnect_data")?.data?.sessions?.[0]
    ?.conversationStates?.find((item) => item?.dialogProcessId === "dp-1");
  assert.equal(reconnectState?.state, "sending");
  assert.equal(reconnectState?.sourceEvent, "interaction_response");
  assert.equal(reconnectState?.requestId, "req-1");
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
    turnScopeId: "turn-snapshot",
    seq: 2,
    content: "first",
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-snapshot",
    dialogProcessId: "dp-snapshot",
    turnScopeId: "turn-snapshot",
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

test("resolving one concurrent interaction atomically publishes the remaining pending snapshot", () => {
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
    turnScopeId: "turn-concurrent",
    seq: 2,
    content: "first concurrent confirmation",
  });
  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-b",
    sessionId: "session-concurrent",
    dialogProcessId: "dp-concurrent",
    turnScopeId: "turn-concurrent",
    seq: 3,
    content: "second concurrent confirmation",
  });
  const stateEventsBeforeResponse = listEvents(client, "channel_state").length;
  const forwarded = manager.forwardToUpstream(channel, {
    action: "interaction_response",
    requestId: "req-a",
    response: { confirmed: true },
  });

  assert.equal(forwarded, true);
  const stateEventsAfterResponse = listEvents(client, "channel_state");
  assert.equal(stateEventsAfterResponse.length, stateEventsBeforeResponse + 1);
  const latestState = stateEventsAfterResponse.at(-1);
  assert.equal(latestState?.data?.state, "interaction_pending");
  assert.equal(latestState?.data?.sourceEvent, "interaction_response");
  assert.deepEqual(latestState?.data?.pendingRequestIds, ["req-b"]);
  assert.equal(latestState?.data?.pendingInteraction?.requestId, "req-b");
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
    turnScopeId: "turn-snapshot",
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

test("workflow child terminal events cannot discard a pending interaction owned by the root channel", async () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "root-session",
    turnScopeId: "root-turn",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-child",
    sessionId: "child-session",
    parentSessionId: "root-session",
    dialogProcessId: "child-dialog",
    turnScopeId: "root-turn",
    content: "confirm child action",
    seq: 49,
  });
  manager.pushChannelEvent(channel, "done", {
    sessionId: "sibling-session",
    parentSessionId: "root-session",
    dialogProcessId: "sibling-dialog",
    turnScopeId: "workflow-node-turn",
    seq: 50,
  });

  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.activity.phase, "running");
  assert.equal(channel.pendingInteractionRequests.has("req-child"), true);
  assert.equal(manager.markChannelTerminal(channel, "done"), false);
  assert.equal(channel.pendingInteractionRequests.has("req-child"), true);

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  await manager.handleReconnect(client, {
    currentSessionId: "root-session",
    currentTurnScopeId: "root-turn",
    lastReceivedSeqMap: { "child-dialog": 49 },
    lastReceivedTurnScopeIdMap: { "child-dialog": "root-turn" },
  });

  const reconnectData = getEvent(client, "reconnect_data");
  const rootSession = reconnectData?.data?.sessions?.find(
    (item) => item?.sessionId === "root-session",
  );
  const childState = rootSession?.conversationStates?.find(
    (item) => item?.dialogProcessId === "child-dialog",
  );
  assert.equal(childState?.state, "interaction_pending");
  assert.equal(childState?.requestId, "req-child");
  assert.equal(childState?.pendingInteraction?.requestId, "req-child");
  assert.deepEqual(childState?.pendingRequestIds, ["req-child"]);
});

test("workflow child terminal state does not own root channel retention", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "root-session",
  });
  channel.status = "running";

  manager.pushChannelEvent(channel, "done", {
    sessionId: "child-session",
    parentSessionId: "root-session",
    dialogProcessId: "child-dialog",
    turnScopeId: "child-turn",
    seq: 10,
  });

  assert.equal(channel.activity.phase, "running");
  assert.equal(channel.retention.phase, "active");
  assert.equal(channel.conversationStateByDialogProcessId.get("child-dialog"), undefined);
});

test("invalid interaction_request has no journal, route, pending, or state side effects", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId: "session-invalid" }), {
    userId: "user-1",
    sessionId: "session-invalid",
  });
  const result = manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-invalid",
    sessionId: "session-invalid",
    dialogProcessId: "dp-invalid",
    turnScopeId: "turn-invalid",
  });
  assert.equal(result, null);
  assert.equal(channel.eventJournal.events.length, 0);
  assert.equal(channel.pendingInteractionRequests.has("req-invalid"), false);
  assert.equal(manager.requestChannelMap.has("req-invalid"), false);
  assert.equal(channel.conversationStateByDialogProcessId.has("dp-invalid"), false);
});

test("only an authoritative lifecycle envelope projects conversation state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "user-1", sessionId: "session-authority" }), {
    userId: "user-1",
    sessionId: "session-authority",
  });
  manager.pushChannelEvent(channel, "done", {
    sessionId: "session-authority",
    dialogProcessId: "dp-authority",
    turnScopeId: "turn-authority",
    seq: 1,
  });
  assert.equal(channel.conversationStateByDialogProcessId.has("dp-authority"), false);

  manager.pushChannelEvent(channel, "turn_lifecycle", {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventId: "authority-1",
    eventType: "turn.processing_started",
    sessionId: "session-authority",
    turnScopeId: "turn-authority",
    dialogProcessId: "dp-authority",
    messageId: "message-authority",
    presentationMessageId: "message-authority",
    revision: 1,
    sequence: 1,
    state: "processing",
    phase: "processing",
  });
  assert.equal(channel.conversationStateByDialogProcessId.get("dp-authority")?.state, "sending");
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
    turnScopeId: "turn-resolve",
    content: "confirm",
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
