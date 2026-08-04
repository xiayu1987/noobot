/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createWebSocketCommandRequests } from "../../../../src/infrastructure/websocket/chatWebSocketCommandRequests.js";

describe("chat websocket command transport diagnostics", () => {
  it("reports command sending and sent around the physical websocket write", () => {
    const socket = { readyState: 1, send: vi.fn() };
    const onCommandSending = vi.fn();
    const onCommandSent = vi.fn();
    const command = { protocolVersion: 1, commandType: "stop", commandId: "command-1" };
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const requests = createWebSocketCommandRequests({
      getActiveSocket: () => socket,
      timeoutMs: 100,
      translateText: (key) => key,
      onCommandSending,
      onCommandSent,
    });

    requests.sendJson(command);

    expect(onCommandSending).toHaveBeenCalledWith(command);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(command));
    expect(onCommandSent).toHaveBeenCalledWith(command);
    vi.unstubAllGlobals();
  });

  it("reports a failed command without swallowing the transport error", () => {
    const error = new Error("send failed");
    const socket = { readyState: 1, send: vi.fn(() => { throw error; }) };
    const onCommandSendFailed = vi.fn();
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const requests = createWebSocketCommandRequests({
      getActiveSocket: () => socket,
      timeoutMs: 100,
      translateText: (key) => key,
      onCommandSendFailed,
    });

    expect(() => requests.sendJson({ commandId: "command-2" })).toThrow(error);
    expect(onCommandSendFailed).toHaveBeenCalledWith({ commandId: "command-2" }, error);
    vi.unstubAllGlobals();
  });
});
