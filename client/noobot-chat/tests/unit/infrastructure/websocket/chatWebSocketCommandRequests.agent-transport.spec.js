/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_TRANSPORT_EVENT,
  createAgentCommandRejection,
  parseAgentTransportFrame,
} from "@noobot/agent-transport-protocol";
import { createWebSocketCommandRequests } from "../../../../src/infrastructure/websocket/chatWebSocketCommandRequests.js";

function createDiagnosticCallbacks() {
  return { onCommandSending: vi.fn(), onCommandSent: vi.fn(), onCommandSendFailed: vi.fn() };
}

describe("chat websocket command transport diagnostics", () => {
  it("reports command sending and sent around the physical websocket write", () => {
    const socket = { readyState: 1, send: vi.fn() };
    const { onCommandSending, onCommandSent, onCommandSendFailed } = createDiagnosticCallbacks();
    const command = { protocolVersion: 1, commandType: "stop", commandId: "command-1" };
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const requests = createWebSocketCommandRequests({
      getActiveSocket: () => socket,
      timeoutMs: 100,
      translateText: (key) => key,
      onCommandSending,
      onCommandSent,
      onCommandSendFailed,
    });

    requests.sendJson(command);

    expect(onCommandSending).toHaveBeenCalledWith(command);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(command));
    expect(onCommandSent).toHaveBeenCalledWith(command);
    vi.unstubAllGlobals();
  });

  it("reports a failed command without swallowing the transport error", () => {
    const error = new Error("send failed");
    const socket = {
      readyState: 1,
      send: vi.fn(() => {
        throw error;
      }),
    };
    const { onCommandSending, onCommandSent, onCommandSendFailed } = createDiagnosticCallbacks();
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const requests = createWebSocketCommandRequests({
      getActiveSocket: () => socket,
      timeoutMs: 100,
      translateText: (key) => key,
      onCommandSending,
      onCommandSent,
      onCommandSendFailed,
    });

    expect(() => requests.sendJson({ commandId: "command-2" })).toThrow(error);
    expect(onCommandSendFailed).toHaveBeenCalledWith({ commandId: "command-2" }, error);
    vi.unstubAllGlobals();
  });

  it("rejects the pending request when the proxy directly rejects the command", async () => {
    const socket = { readyState: 1, send: vi.fn() };
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const requests = createWebSocketCommandRequests({
      getActiveSocket: () => socket,
      timeoutMs: 1000,
      translateText: (key) => key,
      ...createDiagnosticCallbacks(),
    });
    const command = {
      protocolVersion: 1,
      commandType: "stop",
      commandId: "command-3",
      identity: { sessionId: "session-1", turnScopeId: "client-turn:turn-1" },
    };
    const rejection = createAgentCommandRejection({
      command,
      error: { code: "upstream_unavailable", message: "upstream unavailable" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    const pending = requests.requestJson(command, { expectedEvents: [] });
    requests.settle(AGENT_TRANSPORT_EVENT.COMMAND_REJECTED, rejection);

    await expect(pending).rejects.toMatchObject({
      message: "upstream unavailable",
      event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
      data: rejection,
    });
    vi.unstubAllGlobals();
  });

  it("refuses a rejection frame that violates the rejection protocol at the frame boundary", () => {
    expect(() =>
      parseAgentTransportFrame({
        event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
        data: {
          protocolVersion: 1,
          commandId: "command-4",
          commandType: "stop",
          identity: { sessionId: "session-1" },
          occurredAt: "2026-01-01T00:00:00.000Z",
          error: { code: "x", message: "x" },
          outcome: "failed",
        },
      }),
    ).toThrow(/unknown_rejection_field/);
  });
});
