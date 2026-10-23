/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { AGENT_CHANNEL_STATE } from "@noobot/agent-transport-protocol";
import { createChannelKey } from "../../src/shared/utils.js";
import { INTERACTION_EVENT_TYPE } from "@noobot/event-protocol";
import {
  canonicalInteractionRequest,
  createMockSocket,
  listEvents,
} from "./channel-manager.state-consistency.test-helpers.js";

test("newly attached subscriber should receive no_conversation snapshot state", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-init" });
  const channel = manager.ensureChannel(channelKey, {
    userId: "user-1",
    sessionId: "session-init",
  });

  const client = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, client);
  const stateEvents = listEvents(client, "channel_state");
  assert.equal(
    stateEvents.some((item) => item?.data?.state === "no_conversation"),
    true,
  );
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
  assert.equal(manager.markChannelTerminal(channel, AGENT_CHANNEL_STATE.COMPLETED), true);
  const beforeDetachMs = Date.now();

  assert.doesNotThrow(() => manager.detachSocketFromAllChannels(client));
  assert.equal(channel.subscribers.has(client), false);
  assert.equal(client.__agentProxyChannelKeys.size, 0);
  assert.deepEqual(client.__agentProxyLastSequenceByChannel, {});
  assert.equal(channel.retention.cleanupAfterMs >= beforeDetachMs, true);
});

test("resolveChannelFromSocketMessage rejects explicit channelKey from another session", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const oldKey = createChannelKey({ userId: "user-1", sessionId: "session-old" });
  manager.ensureChannel(oldKey, { userId: "user-1", sessionId: "session-old" });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(
    createMockSocket({ apiKey: "api-key-1", userId: "user-1" }),
    {
      channelKey: oldKey,
      commandType: "continue",
      identity: { sessionId: "session-new" },
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
  socket.__agentProxyActiveChannelKey = createChannelKey({
    userId: "user-1",
    sessionId: "session-old",
  });

  const resolvedChannel = manager.resolveChannelFromSocketMessage(socket, {
    commandType: "continue",
    identity: { sessionId: "session-new" },
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
  channel.transport.socket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  assert.equal(manager.markChannelTerminal(channel, AGENT_CHANNEL_STATE.COMPLETED), true);
  manager.pushChannelEvent(
    channel,
    INTERACTION_EVENT_TYPE.REQUEST,
    canonicalInteractionRequest({
      requestId: "req-cleanup",
      sessionId: "session-cleanup",
      dialogProcessId: "dp-cleanup",
    }),
  );
  channel.retention.cleanupAfterMs = Date.now() - 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.channelStore.has(channelKey), false);
  assert.equal(manager.getChannelByRequestId("req-cleanup"), null);
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
  channel.transport.socket = {
    close(code, reason) {
      closed.push({ code, reason });
    },
  };

  channel.updatedAtMs = 1;

  manager.cleanupExpiredChannels();

  assert.equal(manager.channelStore.has(channelKey), false);
  assert.deepEqual(closed, [{ code: 1000, reason: "cleanup" }]);
});
