/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { CHANNEL_RETENTION_PHASE, CHANNEL_STATUS } from "../../src/shared/constants.js";
import { createChannelKey } from "../../src/shared/utils.js";
import {
  createMockSocket,
  canonicalMessageEvent,
  FakeUpstreamWebSocket,
  getEvent,
  listEvents,
  sortReconnectSessions,
} from "./channel-manager.state-consistency.test-helpers.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_PROTOCOL_VERSION,
} from "@noobot/session-protocol";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

test("data-plane events do not create channel business state from start payload", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-turn-scope" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-turn-scope",
    turnScopeId: "turn-scope-1",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  client.sentEvents = [];

  manager.pushChannelEvent(channel, MESSAGE_EVENT_WIRE_EVENT, canonicalMessageEvent({
    sessionId: "session-turn-scope",
    turnScopeId: "turn-scope-1",
  }));

  assert.equal(listEvents(client, "channel_state").length, 0);
  assert.equal(channel.conversationStateByDialogProcessId.has("dp-turn-scope"), false);
});



test("reconnect does not derive authoritative sending state from a running transport", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-snapshot-running" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-snapshot-running",
    turnScopeId: "turn-scope-snapshot-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-snapshot-running",
  });

  const firstState = client.sentEvents.find((eventItem) => eventItem?.event === "channel_state");
  assert.equal(firstState?.data?.state, "no_conversation");
  assert.equal(
    client.sentEvents.some(
      (eventItem) => eventItem?.event === "channel_state" && eventItem?.data?.state === "sending",
    ),
    false,
  );
});

test("reconnect leaves business state empty for a running transport without authoritative events", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-running-empty" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-running-empty",
    turnScopeId: "turn-scope-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-running-empty",
  });

  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-running-empty",
  );
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
  assert.equal("conversationStates" in sessionEntry, false);
});

test("reconnect does not manufacture an error when a transport socket disappears", () => {
  const manager = new ChannelManager({ CONNECTING: 0, OPEN: 1 });
  const sessionId = "session-orphaned-running";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-orphaned-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamEverConnected = true;
  channel.upstreamSocket = null;
  channel.upstreamClosed = true;

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, { currentSessionId: sessionId });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === sessionId,
  );
  assert.equal(channel.status, "running");
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
  assert.equal("conversationStates" in sessionEntry, false);
});

test("reconnect keeps transport status separate from authoritative running state", () => {
  const manager = new ChannelManager({ CONNECTING: 0, OPEN: 1 });
  const sessionId = "session-live-running";
  const channelKey = createChannelKey({ userId: "user-1", sessionId });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId,
    turnScopeId: "turn-live-running",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  channel.upstreamEverConnected = true;
  channel.upstreamSocket = { readyState: 1 };
  channel.upstreamClosed = false;

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, { currentSessionId: sessionId });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === sessionId,
  );
  assert.equal(channel.status, "running");
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
});


test("reconnect does not infer a running Turn from same-user transport identity", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-user-fallback" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-user-fallback",
    turnScopeId: "turn-scope-user-fallback",
  });
  channel.status = "running";
  channel.ownerApiKey = "api-key-old";
  channel.ownerUserId = "user-1";

  const reconnectClient = createMockSocket({ apiKey: "api-key-new", userId: "" });
  manager.handleReconnect(reconnectClient, {
    userId: "user-1",
    currentSessionId: "session-user-fallback",
  });

  const reconnectData = getEvent(reconnectClient, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-user-fallback",
  );
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
  assert.equal("conversationStates" in sessionEntry, false);
});

