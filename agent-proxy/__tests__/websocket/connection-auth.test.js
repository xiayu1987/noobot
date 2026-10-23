/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_TRANSPORT_ERROR_CODE } from "@noobot/agent-transport-protocol";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { authenticateDownstreamSocket } from "../../src/websocket/connection-auth.js";
import { AGENT_PROXY_CLOSE_REASON } from "../../src/shared/constants.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { initializeDownstreamSocketState } from "../../src/websocket/downstream-socket-state.js";

function createGateHarness() {
  const manager = new ChannelManager({ OPEN: 1 });
  const errors = [];
  const closed = [];
  manager.sendSocketError = (socket, error) => errors.push(error);
  const socket = initializeDownstreamSocketState({});
  const close = (target, options) => closed.push({ target, ...options });
  return { manager, errors, closed, socket, close };
}

test("connection gate closes sockets whose apiKey has no recorded identity", () => {
  const { manager, errors, closed, socket, close } = createGateHarness();

  const authenticated = authenticateDownstreamSocket({
    socket,
    requestInfo: { apiKey: "unknown-key", locale: "en" },
    channelManager: manager,
    close,
  });

  assert.equal(authenticated, false);
  assert.equal(Object.hasOwn(socket, "__agentProxyUserId"), false);
  assert.deepEqual(
    errors.map((error) => error.code),
    [AGENT_TRANSPORT_ERROR_CODE.UNAUTHENTICATED],
  );
  assert.deepEqual(closed, [
    { target: socket, code: 1008, reason: AGENT_PROXY_CLOSE_REASON.UNAUTHENTICATED },
  ]);
});

test("connection gate snapshots the recorded userId onto the socket", () => {
  const { manager, errors, closed, socket, close } = createGateHarness();
  manager.saveApiKeyIdentity({ apiKey: "key-1", userId: "user-1" });

  const authenticated = authenticateDownstreamSocket({
    socket,
    requestInfo: { apiKey: "key-1", locale: "zh-CN" },
    channelManager: manager,
    close,
  });

  assert.equal(authenticated, true);
  assert.equal(socket.__agentProxyUserId, "user-1");
  assert.equal(socket.__agentProxyApiKey, "key-1");
  assert.equal(socket.__agentProxyLocale, "zh-CN");
  assert.deepEqual(errors, []);
  assert.deepEqual(closed, []);
});

test("saveApiKeyIdentity rejects non-canonical apiKey or userId", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  for (const identity of [
    { apiKey: "", userId: "user-1" },
    { apiKey: "key-1", userId: "" },
    { apiKey: "key-1", userId: " user-1" },
  ]) {
    assert.throws(() => manager.saveApiKeyIdentity(identity), TypeError);
  }
  assert.equal(manager.apiKeyIdentityStore.size, 0);
});

test("channel permission belongs only to the userId encoded in the channel key", () => {
  const manager = new ChannelManager({ OPEN: 1 });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, { sessionId: "session-1" });

  assert.equal(manager.hasChannelPermission(channel, { __agentProxyUserId: "user-1" }), true);
  assert.equal(manager.hasChannelPermission(channel, { __agentProxyUserId: "user-2" }), false);
});
