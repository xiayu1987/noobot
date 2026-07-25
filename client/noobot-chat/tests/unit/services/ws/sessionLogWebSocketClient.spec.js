/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.closeCall = { code, reason };
  }
}

async function importClient() {
  vi.resetModules();
  return import("../../../../src/services/ws/sessionLogWebSocketClient.js");
}

function sentRecords(socket) {
  return socket.sent.map((payload) => JSON.parse(payload));
}

function sentBusinessRecords(socket) {
  return sentRecords(socket).filter(
    (record) => !String(record.event || "").startsWith("frontend.sessionLogWs."),
  );
}

describe("sessionLogWebSocketClient", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.unstubAllEnvs();
  });

  it("connects to resolved log websocket url and flushes queued session log events", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs", source: "frontend" });

    expect(client.log({ category: "state", event: "stateMachine.event", sessionId: "s-1", data: { state: "sending" } })).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://test/logs");
    expect(MockWebSocket.instances[0].sent).toHaveLength(0);

    MockWebSocket.instances[0].readyState = MockWebSocket.OPEN;
    MockWebSocket.instances[0].onopen?.();

    expect(sentBusinessRecords(MockWebSocket.instances[0])).toContainEqual(expect.objectContaining({
      source: "frontend",
      category: "state",
      event: "stateMachine.event",
      sessionId: "s-1",
      data: { state: "sending" },
    }));
    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 0 }));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ event: "ack", count: MockWebSocket.instances[0].sent.length }),
    });
    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 0, inFlightLength: 0 }));
  });

  it("keeps only the newest 500 queued events while disconnected", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    for (let index = 0; index < 505; index += 1) {
      client.log({ category: "message", event: `message.${index}`, sessionId: "s-queue" });
    }

    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const businessRecords = sentBusinessRecords(socket);
    expect(businessRecords).toHaveLength(500);
    expect(businessRecords[0].event).toBe("message.5");
    expect(businessRecords.at(-1).event).toBe("message.504");
  });

  it("restores sent-but-unacked events when the websocket closes", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    client.log({ category: "message", event: "message.pending", sessionId: "s-retry" });
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(sentBusinessRecords(socket)).toHaveLength(1);
    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 0 }));

    socket.readyState = MockWebSocket.CLOSED;
    socket.onclose?.({ code: 1006, reason: "" });

    expect(client.status()).toEqual(expect.objectContaining({ inFlightLength: 0, hasReconnectTimer: true }));
    expect(client.status().queueLength).toBeGreaterThanOrEqual(1);
  });

  it("physically closes an errored socket even when no close event follows", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    client.log({ category: "message", event: "message.error", sessionId: "s-error" });
    const socket = MockWebSocket.instances[0];
    socket.onerror?.();

    expect(socket.closeCall).toEqual({ code: 1011, reason: "transport_error" });
    expect(client.status()).toMatchObject({ hasSocket: false, queueLength: 1 });
  });

  it("restores the complete in-flight batch when a synchronous send fails", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    client.log({ category: "message", event: "message.send-failure", sessionId: "s-retry" });
    const socket = MockWebSocket.instances[0];
    socket.send = () => { throw new DOMException("socket closing", "InvalidStateError"); };
    socket.readyState = MockWebSocket.OPEN;

    expect(() => socket.onopen?.()).not.toThrow();
    expect(client.status()).toMatchObject({
      queueLength: 1,
      inFlightLength: 0,
      hasSocket: false,
      hasReconnectTimer: true,
    });
  });

  it("ignores close/error callbacks from a superseded socket", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    client.log({ category: "message", event: "message.first", sessionId: "s-stale" });
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.readyState = MockWebSocket.OPEN;
    firstSocket.onopen?.();
    firstSocket.readyState = MockWebSocket.CLOSED;
    firstSocket.onclose?.({ code: 1006, reason: "network" });

    await vi.advanceTimersByTimeAsync(1000);
    const replacementSocket = MockWebSocket.instances.at(-1);
    replacementSocket.readyState = MockWebSocket.OPEN;
    replacementSocket.onopen?.();
    firstSocket.onerror?.();
    firstSocket.onclose?.({ code: 1006, reason: "late" });

    expect(client.status().readyState).toBe(MockWebSocket.OPEN);
  });

  it("suspends after authentication recovery fails instead of reconnecting forever", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const refreshAuthentication = vi.fn(async () => false);
    const client = createSessionLogWebSocketClient({
      resolveWebSocketUrl: () => "ws://test/logs?apikey=stale",
      refreshAuthentication,
    });

    client.log({ category: "message", event: "message.pending", sessionId: "s-auth" });
    const socket = MockWebSocket.instances[0];
    socket.onerror?.();
    await vi.waitFor(() => expect(client.status().suspended).toBe(true));

    expect(refreshAuthentication).toHaveBeenCalledTimes(1);
    expect(client.status()).toEqual(expect.objectContaining({
      queueLength: 1,
      hasReconnectTimer: false,
      suspended: true,
    }));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    client.log({ category: "message", event: "message.after-suspend", sessionId: "s-auth" });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("forwards debug logs to the log websocket so runtime-events can decide recording", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    expect(client.debug({ event: "debug.trace", sessionId: "s-debug", data: { debugType: "state-machine" } })).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({
      category: "debug",
      event: "debug.trace",
      sessionId: "s-debug",
      data: { debugType: "state-machine" },
    }));
  });

  it("does not require a frontend debug switch to send debug logs", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    expect(client.debug({ event: "debug.trace", sessionId: "s-debug" })).toBe(true);
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({ category: "debug", event: "debug.trace", sessionId: "s-debug" }));
  });
});
