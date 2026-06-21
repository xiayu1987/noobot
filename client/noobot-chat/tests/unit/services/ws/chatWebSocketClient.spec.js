import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/services/ws/chatWebSocketClient";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
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
    this.onclose?.({ code, reason });
  }

  emit(event, data = {}) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("chatWebSocketClient", () => {
  let originalWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it("resolves after terminal channel_state when DONE/STOPPED is missing", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onEvent = vi.fn();
    let resolved = false;

    const streamPromise = client.stream({ action: "chat" }, onEvent).then(() => {
      resolved = true;
    });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "completed",
      seq: 2,
    });

    expect(onEvent).toHaveBeenCalledWith({
      event: StreamEventEnum.CHANNEL_STATE,
      data: {
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        state: "completed",
        seq: 2,
      },
    });
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(19);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await streamPromise;
    expect(resolved).toBe(true);
    expect(client.getLastReceivedSeqMap()).toEqual({});
  });

  it("does not resolve stream for non-terminal channel_state", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let settled = false;

    client.stream({ action: "chat" }, vi.fn()).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "sending",
      seq: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
  });

  it("keeps DONE as the immediate stream terminator", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 1000,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    let resolved = false;

    const streamPromise = client.stream({ action: "chat" }, vi.fn()).then(() => {
      resolved = true;
    });

    socket.emit(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      state: "completed",
      seq: 2,
    });
    socket.emit(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      seq: 3,
    });

    await streamPromise;
    expect(resolved).toBe(true);
  });

  it("delivers ERROR events before rejecting", async () => {
    const client = createChatWebSocketClient({
      resolveWebSocketUrl: () => "ws://test",
      terminalChannelStateGraceMs: 20,
      translateText: (key) => key,
    });
    client.connect();
    const socket = MockWebSocket.instances[0];
    const onEvent = vi.fn();

    const streamPromise = client.stream({ action: "chat" }, onEvent);
    const errorData = { error: "boom", sessionId: "s-1", dialogProcessId: "dp-1", seq: 4 };
    socket.emit(StreamEventEnum.ERROR, errorData);

    await expect(streamPromise).rejects.toThrow("boom");
    expect(onEvent).toHaveBeenCalledWith({ event: StreamEventEnum.ERROR, data: errorData });
    expect(client.getLastReceivedSeqMap()).toEqual({ "dp-1": 4 });
    socket.close(1011, "server_error");
  });
});
