/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { createMockSocket } from "./channel-manager.state-consistency.test-helpers.js";
import {
  AGENT_CHANNEL_STATE,
  AGENT_CHANNEL_STATE_SCOPE,
  AGENT_TRANSPORT_EVENT,
} from "@noobot/agent-transport-protocol";

function fixture() {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-1" }),
    { userId: "user-1", sessionId: "session-1" },
  );
  for (let index = 0; index < 6; index += 1) {
    manager.updateConversationState(channel, {
      scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
      sessionId: "session-1",
      turnScopeId: `turn-${index}`,
      dialogProcessId: `dialog-${index}`,
      state: AGENT_CHANNEL_STATE.COMPLETED,
      sourceEvent: "turn.completed",
      seq: index + 1,
      broadcast: false,
    });
  }
  const socket = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  return { manager, channel, socket };
}

test("an existing subscription does not resend historical state or reset its cursor", () => {
  const { manager, channel, socket } = fixture();
  manager.attachSubscriber(channel, socket);
  assert.equal(socket.sentEvents.length, 7);
  assert.ok(
    socket.sentEvents.every((event) => event.event === AGENT_TRANSPORT_EVENT.CHANNEL_STATE),
  );
  socket.__agentProxyLastSequenceByChannel[channel.key] = 42;
  manager.attachSubscriber(channel, socket);
  assert.equal(socket.sentEvents.length, 7);
  assert.equal(socket.__agentProxyLastSequenceByChannel[channel.key], 42);
  assert.equal(channel.subscribers.size, 1);
  manager.updateConversationState(channel, {
    scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
    sessionId: "session-1",
    turnScopeId: "turn-next",
    dialogProcessId: "dialog-next",
    state: AGENT_CHANNEL_STATE.COMPLETED,
    sourceEvent: "turn.completed",
    seq: 7,
  });
  assert.equal(socket.sentEvents.length, 8);
  assert.equal(socket.sentEvents.at(-1).data.turnScopeId, "turn-next");
});

test("a detached socket receives the current state when it subscribes again", () => {
  const { manager, channel, socket } = fixture();
  manager.attachSubscriber(channel, socket);
  manager.detachSocketFromAllChannels(socket);
  manager.attachSubscriber(channel, socket);
  assert.equal(socket.sentEvents.length, 14);
  assert.equal(socket.__agentProxyLastSequenceByChannel[channel.key], 0);
});

test("reconnect can attach without publishing a snapshot before its baseline", () => {
  const { manager, channel, socket } = fixture();
  manager.attachSubscriber(channel, socket, { sendStateSnapshot: false });
  assert.equal(socket.sentEvents.length, 0);
  manager.sendChannelStateSnapshot(channel, socket);
  assert.equal(socket.sentEvents.length, 7);
});

test("an explicit reconnect baseline still refreshes an existing subscription", () => {
  const { manager, channel, socket } = fixture();
  manager.attachSubscriber(channel, socket);
  manager.attachSubscriber(channel, socket, { sendStateSnapshot: false });
  assert.equal(socket.sentEvents.length, 7);
  manager.sendChannelStateSnapshot(channel, socket);
  assert.equal(socket.sentEvents.length, 14);
});
