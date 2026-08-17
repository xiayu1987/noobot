/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, vi } from "vitest";
import { AGENT_COMMAND, createTurnRunCommand } from "@noobot/agent-transport-protocol";

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  static initialReadyState = MockWebSocket.OPEN;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.initialReadyState;
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

  emit(event, data = {}, channelSessionId = "") {
    this.onmessage?.({
      data: JSON.stringify({
        event,
        data,
        ...(channelSessionId ? { channelSessionId } : {}),
      }),
    });
  }
}

export const flushPromises = () => Promise.resolve();

export function streamCommand(identity = {}) {
  return createTurnRunCommand({
    commandType: AGENT_COMMAND.SEND,
    commandId: `test-stream:${identity.turnScopeId || "unscoped"}`,
    identity,
    input: { message: "test", attachments: [] },
  });
}

export function setupWebSocketTestHooks() {
  let originalWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    MockWebSocket.initialReadyState = MockWebSocket.OPEN;
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });
}
