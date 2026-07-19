/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { createMockSocket, getEvent, listEvents, FakeUpstreamWebSocket } from "./channel-manager.state-consistency.test-helpers.js";

test("stop action should broadcast stopping state before terminal", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = {
    readyState: 1,
    send() {},
  };
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  manager.updateConversationState(channel, {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    state: "stopping",
    sourceEvent: "stop",
    seq: 1,
  });
  manager.pushChannelEvent(channel, "user_stopped", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 2,
  });
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.some((item) => item?.data?.state === "stopping"), true);
  assert.equal(stateEvents.some((item) => item?.data?.state === "user_stopped"), true);
});

test("startOrJoinChannel restarts running channel when upstream socket is not open", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-stale" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-stale" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = { readyState: 3, close() {} };

  let closeCount = 0;
  let connectCount = 0;
  manager.closeUpstreamChannel = (targetChannel) => {
    assert.equal(targetChannel, channel);
    closeCount += 1;
    targetChannel.upstreamSocket = null;
  };
  manager.connectUpstreamChannel = (targetChannel, apiKey) => {
    assert.equal(targetChannel, channel);
    assert.equal(apiKey, "api-key-1");
    connectCount += 1;
    targetChannel.status = "connecting";
    targetChannel.upstreamSocket = { readyState: 0 };
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.startOrJoinChannel({
    socket: client,
    connectionApiKey: "api-key-1",
    payload: { userId: "user-1", sessionId: "session-stale", action: "start" },
  });

  assert.equal(closeCount, 1);
  assert.equal(connectCount, 1);
  assert.equal(channel.startPayload?.sessionId, "session-stale");
  assert.equal(channel.eventLog.length, 0);
});

test("startOrJoinChannel keeps running channel when upstream socket is open", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-live" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-live" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamSocket = { readyState: 1, close() {} };

  let connectCount = 0;
  manager.connectUpstreamChannel = () => {
    connectCount += 1;
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.startOrJoinChannel({
    socket: client,
    connectionApiKey: "api-key-1",
    payload: { userId: "user-1", sessionId: "session-live", action: "start" },
  });

  assert.equal(connectCount, 0);
  assert.equal(channel.upstreamSocket.readyState, 1);
});

test("forwarded stop does not synthesize stopping before Service confirms it", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-stop" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-stop",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const upstreamMessages = [];
  channel.upstreamSocket = {
    readyState: 1,
    send(raw) {
      upstreamMessages.push(JSON.parse(String(raw || "{}")));
    },
  };

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);

  const forwarded = manager.forwardToUpstream(channel, {
    action: "stop",
    userId: "user-1",
    sessionId: "session-stop",
    dialogProcessId: "dp-stop",
    turnScopeId: "turn-stop",
  });
  assert.equal(forwarded, true);

  assert.equal(upstreamMessages.length, 1);
  assert.equal(channel.status, "running");
  const reconnectClient = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(reconnectClient, { currentSessionId: "session-stop", lastReceivedSeqMap: {} });

  const reconnectData = getEvent(reconnectClient, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (entry) => String(entry?.sessionId || "") === "session-stop",
  );
  assert.ok(sessionEntry);
  assert.equal(sessionEntry.hasRunningTask, false);
  assert.equal(
    (sessionEntry.conversationStates || []).some((item) => item?.state === "stopping"),
    false,
  );

  const stoppedEnvelope = manager.pushChannelEvent(channel, "user_stopped", {
    sessionId: "session-stop",
    dialogProcessId: "dp-stop",
    turnScopeId: "turn-stop",
    message: "user stop persisted",
  });
  manager.markChannelTerminal(channel, "user_stopped");
  manager.broadcastChannelEvent(channel, stoppedEnvelope);

  const completedReconnectClient = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(completedReconnectClient, { currentSessionId: "session-stop", lastReceivedSeqMap: {} });
  const completedReconnectData = getEvent(completedReconnectClient, "reconnect_data");
  const completedSessionEntry = (completedReconnectData?.data?.sessions || []).find(
    (entry) => String(entry?.sessionId || "") === "session-stop",
  );
  assert.equal(completedSessionEntry?.hasRunningTask, false);
  assert.equal(
    (completedSessionEntry?.conversationStates || []).some((item) => item?.state === "user_stopped"),
    true,
  );
});

test("upstream close without authoritative event does not synthesize a turn terminal", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-upstream-close" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-upstream-close",
    turnScopeId: "turn-upstream-close",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  upstream.close(1006, "network_lost");

  assert.equal(channel.status, "open");
  assert.equal(listEvents(client, "user_stopped").length, 0);
  assert.equal(listEvents(client, "error").length, 0);
});

test("upstream close reason user_stopped is transport metadata, not confirmation", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-user-close" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-user-close",
    turnScopeId: "turn-user-close",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN");
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  upstream.close(1000, "user_stopped");

  assert.equal(channel.status, "open");
  assert.equal(listEvents(client, "error").length, 0);
  assert.equal(listEvents(client, "user_stopped").length, 0);
});

