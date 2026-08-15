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
  FakeUpstreamWebSocket,
  getEvent,
  listEvents,
  sortReconnectSessions,
} from "./channel-manager.state-consistency.test-helpers.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_PROTOCOL_VERSION,
} from "@noobot/session-protocol";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

test("reconnect state should be consistent for all same-user clients across channel statuses", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const statusMatrix = [
    { status: "idle" },
    { status: "connecting" },
    { status: "running" },
    { status: "done" },
    { status: "user_stopped" },
    { status: "error" },
  ];

  for (const item of statusMatrix) {
    const sessionId = `session-${item.status}`;
    const dpId = `dp-${item.status}`;
    const channelKey = createChannelKey({ userId: "user-1", sessionId });
    const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId });
    channel.ownerApiKey = "api-key-1";
    channel.ownerUserId = "user-1";
    manager.pushChannelEvent(channel, "thinking", {
      sessionId,
      dialogProcessId: dpId,
      seq: 1,
      text: item.status,
    });
    channel.status = item.status;
  }

  const clientA = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const clientB = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });

  manager.handleReconnect(clientA, { currentSessionId: "" });
  manager.handleReconnect(clientB, { currentSessionId: "" });

  const reconnectDataA = getEvent(clientA, "reconnect_data");
  const reconnectDataB = getEvent(clientB, "reconnect_data");
  assert.ok(reconnectDataA, "clientA should receive reconnect_data");
  assert.ok(reconnectDataB, "clientB should receive reconnect_data");

  const normalizedSessionsA = sortReconnectSessions(reconnectDataA.data);
  const normalizedSessionsB = sortReconnectSessions(reconnectDataB.data);
  assert.deepEqual(
    normalizedSessionsA.map((entry) => ({
      sessionId: entry.sessionId,
      replayBatch: entry.replayBatch,
    })),
    normalizedSessionsB.map((entry) => ({
      sessionId: entry.sessionId,
      replayBatch: entry.replayBatch,
    })),
    "all same-user clients should see identical replay protocol state",
  );

  for (const item of statusMatrix) {
    const sessionEntry = normalizedSessionsA.find(
      (entry) => entry.sessionId === `session-${item.status}`,
    );
    assert.ok(sessionEntry, `missing session for status=${item.status}`);
    assert.equal("hasRunningTask" in sessionEntry, false);
    assert.equal("currentRun" in sessionEntry, false);
    assert.equal("dialogProcesses" in sessionEntry, false);
    const rawSessionEntry = (reconnectDataA.data?.sessions || []).find(
      (entry) => String(entry?.sessionId || "") === `session-${item.status}`,
    );
    assert.equal("conversationStates" in rawSessionEntry, false);
  }
});

test("reconnect state should be isolated between different users", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "running";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "delta", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
    text: "hello",
  });

  const otherUserClient = createMockSocket({ apiKey: "api-key-2", userId: "user-2" });
  manager.handleReconnect(otherUserClient, {
    currentSessionId: "session-1",
  });

  const reconnectData = getEvent(otherUserClient, "reconnect_data");
  assert.ok(reconnectData);
  assert.deepEqual(reconnectData?.data?.sessions || [], []);
});

test("reconnect should include conversationStates snapshot", () => {
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
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    requestId: "req-1",
    content: "confirm",
    seq: 2,
  });

  const client = createMockSocket({ apiKey: "api-key-2", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-1",
  });
  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-1",
  );
  const pendingInteraction = sessionEntry?.replayBatch?.pendingInteractions?.find(
    (item) => String(item?.data?.requestId || item?.requestId || "") === "req-1",
  );
  assert.equal(pendingInteraction?.data?.dialogProcessId || pendingInteraction?.dialogProcessId, "dp-1");
  assert.equal("conversationStates" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
});

test("reconnect preserves cached authoritative states without synthesizing currentRun", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-current-run" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-current-run",
    turnScopeId: "turn-current",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.updateConversationState(channel, {
    sessionId: "session-current-run",
    dialogProcessId: "dp-old",
    turnScopeId: "turn-old",
    state: "user_stopped",
    seq: 12,
  });
  manager.updateConversationState(channel, {
    sessionId: "session-current-run",
    dialogProcessId: "dp-current",
    turnScopeId: "turn-current",
    state: "completed",
    seq: 20,
  });
  channel.status = "done";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-current-run",
  });

  const reconnectData = getEvent(client, "reconnect_data");
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-current-run",
  );
  assert.equal("hasRunningTask" in sessionEntry, false);
  assert.equal("currentRun" in sessionEntry, false);
  assert.equal("conversationStates" in sessionEntry, false);
});

test("reconnect does not expose the removed data-plane cache-expiry branch", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { userId: "user-1", sessionId: "session-1" });
  channel.status = "connecting";
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";
  manager.pushChannelEvent(channel, "thinking", {
    sessionId: "session-1",
    dialogProcessId: "dp-1",
    seq: 1,
  });

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.handleReconnect(client, {
    currentSessionId: "session-1",
  });
  const reconnectData = getEvent(client, "reconnect_data");
  assert.ok(reconnectData);
  const sessionEntry = (reconnectData?.data?.sessions || []).find(
    (item) => String(item?.sessionId || "") === "session-1",
  );
  assert.equal("conversationStates" in sessionEntry, false);
  assert.equal("cacheExpired" in sessionEntry.replayBatch, false);
  assert.equal("cacheExpired" in reconnectData.data, false);
});
