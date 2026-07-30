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
  return import("../../../../src/infrastructure/websocket/sessionLogWebSocketClient.js");
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

  it("rejects reliable events beyond the bounded queue without generating recursive logs", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    for (let index = 0; index < 505; index += 1) {
      client.log({ category: "message", event: `message.${index}`, sessionId: "s-queue" });
    }

    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(socket.sent).toHaveLength(100);
    expect(sentBusinessRecords(socket)[0].event).toBe("message.0");
    expect(client.status()).toMatchObject({ queueLength: 400, inFlightLength: 100, rejectedReliableCount: 5 });

    for (let batch = 0; batch < 5; batch += 1) {
      socket.onmessage?.({ data: JSON.stringify({ event: "ack", count: 100 }) });
    }
    socket.onmessage?.({ data: JSON.stringify({ event: "ack", count: 100 }) });
    const records = sentRecords(socket);
    expect(records.filter((record) => record.event === "frontend.sessionLogWs.queueCapacityExceeded")).toHaveLength(0);
    expect(sentBusinessRecords(socket)).toHaveLength(500);
    expect(sentBusinessRecords(socket).at(-1).event).toBe("message.499");
  });

  it("sends the next bounded batch only after the current batch is fully acknowledged", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });
    for (let index = 0; index < 150; index += 1) client.log({ event: `ordered.${index}`, sessionId: "s-order" });
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();
    expect(socket.sent).toHaveLength(100);
    socket.onmessage?.({ data: JSON.stringify({ event: "ack", count: 40 }) });
    expect(socket.sent).toHaveLength(100);
    socket.onmessage?.({ data: JSON.stringify({ event: "ack", count: 60 }) });
    expect(socket.sent).toHaveLength(150);
    expect(sentBusinessRecords(socket).map((record) => record.event)).toEqual(
      Array.from({ length: 150 }, (_, index) => `ordered.${index}`),
    );
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

  it("keeps one bounded reconnect after a transient authentication recovery failure", async () => {
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
    await vi.waitFor(() => expect(client.status().hasReconnectTimer).toBe(true));

    expect(refreshAuthentication).toHaveBeenCalledTimes(1);
    expect(client.status()).toEqual(expect.objectContaining({
      queueLength: 1,
      hasReconnectTimer: true,
      suspended: false,
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    const recoveredSocket = MockWebSocket.instances[1];
    recoveredSocket.readyState = MockWebSocket.OPEN;
    recoveredSocket.onopen?.();
    expect(sentBusinessRecords(recoveredSocket)).toContainEqual(expect.objectContaining({
      event: "message.pending",
      sessionId: "s-auth",
    }));
  });

  it("forwards only debug types enabled by the server policy", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    expect(client.debug({ event: "debug.trace", sessionId: "s-debug", data: { debugType: "state-machine" } })).toBe(false);
    client.updatePolicy({ debug: { "state-machine": true } });
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

  it("does not invoke a lazy debug payload factory while its type is disabled", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    const factory = vi.fn(() => ({ event: "debug.trace", sessionId: "s-debug" }));
    expect(client.debug("state-machine", factory)).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("drops queued and in-flight debug records on disconnect instead of replaying them", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });
    client.updatePolicy({ debug: { "state-machine": true } });
    client.debug("state-machine", () => ({ event: "debug.first", sessionId: "s-debug" }));
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();
    client.debug("state-machine", () => ({ event: "debug.queued", sessionId: "s-debug" }));

    socket.readyState = MockWebSocket.CLOSED;
    socket.onclose?.({ code: 1006, reason: "network" });

    expect(client.status()).toMatchObject({
      debugQueueLength: 0,
      inFlightLength: 0,
      droppedDebugCount: 2,
      hasReconnectTimer: false,
    });
  });

  it("drops expired debug records before a connection can send them", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });
    client.updatePolicy({ debug: { "state-machine": true }, limits: { debugTtlMs: 5 } });
    client.debug("state-machine", () => ({ event: "debug.expired", sessionId: "s-debug" }));
    const socket = MockWebSocket.instances[0];
    await vi.advanceTimersByTimeAsync(6);
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(socket.sent).toHaveLength(0);
    expect(client.status()).toMatchObject({ debugQueueLength: 0, droppedDebugCount: 1 });
  });

  it("enforces both debug count and byte limits", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "" });
    client.updatePolicy({
      debug: { "state-machine": true },
      limits: { maxDebugQueue: 1, maxDebugBytes: 10000 },
    });
    expect(client.debug("state-machine", () => ({ event: "debug.one", sessionId: "s-debug" }))).toBe(true);
    expect(client.debug("state-machine", () => ({ event: "debug.two", sessionId: "s-debug" }))).toBe(false);
    expect(client.status()).toMatchObject({ debugQueueLength: 1, droppedDebugCount: 1 });

    client.updatePolicy({
      debug: { "state-machine": true },
      limits: { maxDebugQueue: 10, maxDebugBytes: 1 },
    });
    expect(client.debug("state-machine", () => ({ event: "debug.bytes", sessionId: "s-debug" }))).toBe(false);
    expect(client.status().droppedDebugCount).toBe(2);
  });
});
