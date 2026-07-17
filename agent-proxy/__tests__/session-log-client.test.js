/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionLogClient } from "../src/session-log-client.js";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }
}

test("session log client keeps sent logs in flight until ack", () => {
  MockWebSocket.instances = [];
  const client = createSessionLogClient({ WebSocketImpl: MockWebSocket });

  assert.equal(client.log("api-key-1", { category: "state", event: "state.pending", sessionId: "s-1" }), true);
  const socket = MockWebSocket.instances[0];
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen?.();

  assert.equal(socket.sent.length, 1);
  assert.deepEqual(client.status("api-key-1"), {
    queueLength: 0,
    inFlightLength: 1,
    readyState: MockWebSocket.OPEN,
    hasReconnectTimer: false,
  });

  socket.onmessage?.({ data: JSON.stringify({ event: "ack", count: 1 }) });
  assert.deepEqual(client.status("api-key-1"), {
    queueLength: 0,
    inFlightLength: 0,
    readyState: MockWebSocket.OPEN,
    hasReconnectTimer: false,
  });
});

test("session log client restores unacked logs on close", () => {
  MockWebSocket.instances = [];
  const client = createSessionLogClient({ WebSocketImpl: MockWebSocket });

  client.log("api-key-1", { category: "message", event: "message.pending", sessionId: "s-1" });
  const socket = MockWebSocket.instances[0];
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen?.();
  socket.readyState = MockWebSocket.CLOSED;
  socket.onclose?.();

  assert.deepEqual(client.status("api-key-1"), {
    queueLength: 1,
    inFlightLength: 0,
    readyState: MockWebSocket.CLOSED,
    hasReconnectTimer: true,
  });
});
