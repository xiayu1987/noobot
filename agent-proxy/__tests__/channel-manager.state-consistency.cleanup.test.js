import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { createMockSocket, listEvents } from "./channel-manager.state-consistency.test-helpers.js";

test("newly attached subscriber should receive no_conversation snapshot state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-init" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-init",
  });
  channel.ownerApiKey = "api-key-1";
  channel.ownerUserId = "user-1";

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(stateEvents.some((item) => item?.data?.state === "no_conversation"), true);
});

test("detachSocketFromAllChannels should detach terminal subscribers and schedule cleanup", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-detach" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-detach",
  });
  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });

  manager.attachSubscriber(channel, client);
  channel.status = "done";
  const beforeDetachMs = Date.now();

  assert.doesNotThrow(() => manager.detachSocketFromAllChannels(client));
  assert.equal(channel.subscribers.has(client), false);
  assert.equal(client.__agentProxyChannelKeys.size, 0);
  assert.equal(client.__agentProxyActiveChannelKey, "");
  assert.deepEqual(client.__agentProxyLastSequenceByChannel, {});
  assert.equal(channel.cleanupAfterMs >= beforeDetachMs, true);
});

test("resolveChannelFromSocketMessage rejects explicit channelKey from another session", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const oldKey = createChannelKey({ userId: "user-1", sessionId: "session-old" });
  manager.ensureChannel(oldKey, { userId: "user-1", sessionId: "session-old" });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(
    createMockSocket({ apiKey: "api-key-1", userId: "user-1" }),
    {
      action: "continue",
      channelKey: oldKey,
      sessionId: "session-new",
      userId: "user-1",
    },
  );

  assert.equal(resolvedChannel, null);
});

test("resolveChannelFromSocketMessage uses socket userId when continue payload omits userId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-new" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-new",
  });
  const socket = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  socket.__agentProxyActiveChannelKey = createChannelKey({ userId: "user-1", sessionId: "session-old" });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(socket, {
    action: "continue",
    sessionId: "session-new",
  });

  assert.equal(resolvedChannel, channel);
});

test("cleanup should remove expired terminal channel and stale request mapping", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-cleanup" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-cleanup",
  });
  const closed = [];
  channel.upstreamSocket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  manager.pushChannelEvent(channel, "interaction_request", {
    requestId: "req-cleanup",
    sessionId: "session-cleanup",
    dialogProcessId: "dp-cleanup",
    seq: 1,
  });
  channel.status = "done";
  channel.cleanupAfterMs = Date.now() - 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.hasChannel(channelKey), false);
  assert.equal(manager.requestChannelMap.has("req-cleanup"), false);
  assert.deepEqual(closed, [{ code: 1000, reason: "cleanup" }]);
});

test("cleanup should remove expired idle channel without subscribers", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-idle-cleanup" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-idle-cleanup",
  });
  const closed = [];
  channel.upstreamSocket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  channel.status = "idle";
  channel.updatedAtMs = 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.hasChannel(channelKey), false);
  assert.deepEqual(closed, [{ code: 1000, reason: "cleanup" }]);
});

