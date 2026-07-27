/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebSocketTransportSupervisor,
  WEB_SOCKET_TRANSPORT_PHASE,
} from "../../../../src/services/ws/webSocketTransportSupervisor.js";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.close = vi.fn(() => { this.readyState = MockWebSocket.CLOSED; });
  }
}

describe("webSocketTransportSupervisor", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("owns one socket and reuses it while connecting or open", () => {
    const createWebSocket = vi.fn((url) => new MockWebSocket(url));
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket,
    });

    const first = supervisor.acquire();
    const reused = supervisor.acquire();

    expect(reused).toMatchObject({ socket: first.socket, reused: true });
    expect(createWebSocket).toHaveBeenCalledTimes(1);
    first.socket.readyState = MockWebSocket.OPEN;
    expect(supervisor.markOpen(first.socket)).toBe(true);
    expect(supervisor.status()).toMatchObject({
      generation: first.generation,
      phase: WEB_SOCKET_TRANSPORT_PHASE.OPEN,
      hasSocket: true,
    });
  });

  it("records the ready server instance on the current transport generation", () => {
    const supervisor = createWebSocketTransportSupervisor({
      channelId: "chat",
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket: (url) => new MockWebSocket(url),
    });
    const socket = supervisor.acquire().socket;

    expect(supervisor.markReady(socket, { nextServerInstanceId: "proxy-instance-1" })).toBe(true);
    expect(supervisor.status()).toMatchObject({
      phase: WEB_SOCKET_TRANSPORT_PHASE.OPEN,
      serverInstanceId: "proxy-instance-1",
    });
  });

  it("rejects stale callbacks after replacing the owned socket", () => {
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket: (url) => new MockWebSocket(url),
    });
    const first = supervisor.acquire();
    const replacement = supervisor.replace();

    expect(replacement.previousSocket).toBe(first.socket);
    expect(supervisor.release(first.socket)).toBe(false);
    expect(supervisor.current()).toBe(replacement.socket);
    expect(supervisor.release(replacement.socket)).toBe(true);
    expect(supervisor.status()).toMatchObject({ phase: WEB_SOCKET_TRANSPORT_PHASE.IDLE, hasSocket: false });
  });

  it("contains constructor exceptions without publishing a partial generation", () => {
    const supervisor = createWebSocketTransportSupervisor({
      channelId: "chat",
      resolveWebSocketUrl: () => "invalid",
      createWebSocket: () => { throw new DOMException("invalid url", "SyntaxError"); },
    });

    expect(() => supervisor.acquire()).not.toThrow();
    expect(supervisor.acquire()).toBe(null);
    expect(supervisor.status()).toMatchObject({
      generation: 0,
      phase: WEB_SOCKET_TRANSPORT_PHASE.IDLE,
      hasSocket: false,
      reconnectAttempt: 2,
      lastFailureReason: "SyntaxError",
    });
  });

  it("rejects an empty socket factory result as a failed connection attempt", () => {
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket: () => null,
    });

    expect(supervisor.acquire()).toBe(null);
    expect(supervisor.status()).toMatchObject({
      generation: 0,
      hasSocket: false,
      lastFailureReason: "websocket_constructor_returned_empty",
    });
  });

  it("preserves the current generation when replacement construction fails", () => {
    let shouldThrow = false;
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket: (url) => {
        if (shouldThrow) throw new TypeError("replacement failed");
        return new MockWebSocket(url);
      },
    });
    const first = supervisor.acquire();
    first.socket.readyState = MockWebSocket.OPEN;
    supervisor.markReady(first.socket, { nextServerInstanceId: "proxy-1" });
    shouldThrow = true;

    expect(supervisor.replace()).toBe(null);
    expect(supervisor.current()).toBe(first.socket);
    expect(supervisor.isCurrent(first.socket)).toBe(true);
    expect(supervisor.status()).toMatchObject({
      generation: first.generation,
      phase: WEB_SOCKET_TRANSPORT_PHASE.OPEN,
      serverInstanceId: "proxy-1",
      lastFailureReason: "TypeError",
    });
  });

  it("contains websocket URL resolver failures", () => {
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => { throw new Error("auth state unavailable"); },
    });

    expect(() => supervisor.acquire()).not.toThrow();
    expect(supervisor.status()).toMatchObject({
      generation: 0,
      hasSocket: false,
      lastFailureReason: "Error",
    });
  });

  it("prevents new connections while suspended or disposed", () => {
    const createWebSocket = vi.fn((url) => new MockWebSocket(url));
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test/channel",
      createWebSocket,
    });

    supervisor.suspend();
    expect(supervisor.acquire()).toBe(null);
    expect(supervisor.resume()).toBe(true);
    expect(supervisor.acquire()?.socket).toBeTruthy();
    supervisor.dispose();
    expect(supervisor.acquire()).toBe(null);
    expect(supervisor.status().phase).toBe(WEB_SOCKET_TRANSPORT_PHASE.DISPOSED);
    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });

  it("keeps physical sockets isolated between channel supervisors", () => {
    const chat = createWebSocketTransportSupervisor({
      channelId: "chat",
      resolveWebSocketUrl: () => "ws://test/chat",
      createWebSocket: (url) => new MockWebSocket(url),
    });
    const logs = createWebSocketTransportSupervisor({
      channelId: "session-log",
      resolveWebSocketUrl: () => "ws://test/logs",
      createWebSocket: (url) => new MockWebSocket(url),
    });

    const chatSocket = chat.acquire().socket;
    const logSocket = logs.acquire().socket;

    expect(chatSocket).not.toBe(logSocket);
    expect(chatSocket.url).toBe("ws://test/chat");
    expect(logSocket.url).toBe("ws://test/logs");
    expect(chat.status().channelId).toBe("chat");
    expect(logs.status().channelId).toBe("session-log");
  });

  it("shares one authentication recovery promise per channel failure series", async () => {
    let resolveRefresh;
    const refreshAuthentication = vi.fn(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const supervisor = createWebSocketTransportSupervisor({ refreshAuthentication });

    const first = supervisor.refreshCredentials();
    const second = supervisor.refreshCredentials();

    expect(first).toBe(second);
    await Promise.resolve();
    expect(refreshAuthentication).toHaveBeenCalledTimes(1);
    resolveRefresh(true);
    await expect(first).resolves.toBe(true);
    await expect(supervisor.refreshCredentials()).resolves.toBe(null);
  });

  it("backs off instead of suspending after a transient authentication recovery failure", async () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const supervisor = createWebSocketTransportSupervisor({
      refreshAuthentication: vi.fn(async () => false),
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 400,
    });

    await expect(supervisor.recover({ reconnect })).resolves.toBe(true);
    expect(supervisor.status()).toMatchObject({
      phase: WEB_SOCKET_TRANSPORT_PHASE.IDLE,
      hasReconnectTimer: true,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("still supports explicit suspension for authoritative authentication failure", async () => {
    const supervisor = createWebSocketTransportSupervisor({
      refreshAuthentication: vi.fn(async () => false),
    });

    await expect(supervisor.recover({
      reconnect: vi.fn(),
      suspendOnAuthenticationFailure: true,
    })).resolves.toBe(false);
    expect(supervisor.status().phase).toBe(WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED);
  });

  it("owns one bounded reconnect timer and invalidates stale generations", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const supervisor = createWebSocketTransportSupervisor({
      resolveWebSocketUrl: () => "ws://test",
      createWebSocket: (url) => new MockWebSocket(url),
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 400,
    });
    const socket = supervisor.acquire().socket;
    supervisor.noteFailure(socket);

    expect(supervisor.scheduleReconnect(callback)).toBe(true);
    expect(supervisor.scheduleReconnect(callback)).toBe(false);
    expect(supervisor.status().hasReconnectTimer).toBe(true);

    supervisor.acquire();
    await vi.advanceTimersByTimeAsync(100);
    expect(callback).not.toHaveBeenCalled();
  });
});
