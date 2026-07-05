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
}

async function importClient() {
  vi.resetModules();
  return import("../../../../src/services/ws/sessionLogWebSocketClient.js");
}

describe("sessionLogWebSocketClient", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket;
    vi.stubEnv("VITE_NOOBOT_SESSION_LOG_DEBUG", "");
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

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual(expect.objectContaining({
      source: "frontend",
      category: "state",
      event: "stateMachine.event",
      sessionId: "s-1",
      data: { state: "sending" },
    }));
    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 0, inFlightLength: 1 }));

    MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ event: "ack", count: 1 }) });
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

    expect(socket.sent).toHaveLength(500);
    expect(JSON.parse(socket.sent[0]).event).toBe("message.5");
    expect(JSON.parse(socket.sent.at(-1)).event).toBe("message.504");
  });

  it("restores sent-but-unacked events when the websocket closes", async () => {
    vi.useFakeTimers();
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    client.log({ category: "message", event: "message.pending", sessionId: "s-retry" });
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(socket.sent).toHaveLength(1);
    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 0, inFlightLength: 1 }));

    socket.readyState = MockWebSocket.CLOSED;
    socket.onclose?.({ code: 1006, reason: "" });

    expect(client.status()).toEqual(expect.objectContaining({ queueLength: 1, inFlightLength: 0, hasReconnectTimer: true }));
  });

  it("does not enqueue debug logs by default", async () => {
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    expect(client.debug({ event: "debug.trace", sessionId: "s-debug" })).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("sends debug logs when explicitly enabled", async () => {
    vi.stubEnv("VITE_NOOBOT_SESSION_LOG_DEBUG", "true");
    const { createSessionLogWebSocketClient } = await importClient();
    const client = createSessionLogWebSocketClient({ resolveWebSocketUrl: () => "ws://test/logs" });

    expect(client.debug({ event: "debug.trace", sessionId: "s-debug" })).toBe(true);
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({ category: "debug", event: "debug.trace", sessionId: "s-debug" }));
  });
});
