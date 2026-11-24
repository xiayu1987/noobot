/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_TRANSPORT_DEBUG_TYPE } from "@noobot/agent-transport-protocol";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import {
  emitCommandReceipt,
  setupWebSocketTestHooks,
  streamCommand,
} from "./chatWebSocketClientTestFixtures.js";

setupWebSocketTestHooks();
afterEach(() => vi.restoreAllMocks());

function fixture(sessionLogSink) {
  const client = createChatWebSocketClient({
    resolveWebSocketUrl: () => "ws://test",
    sessionLogSink,
  });
  const socket = client.connect();
  const command = streamCommand({
    sessionId: "diagnostic-session",
    parentSessionId: "diagnostic-parent",
    turnScopeId: "diagnostic-turn",
  });
  command.input.message = "private command body";
  return { client, socket, command };
}

describe("agent transport command diagnostics", () => {
  it("uses protocol identity and scoped records without recording message content", async () => {
    const records = [];
    const debug = vi.fn((type, build) => records.push({ type, record: build() }));
    const { client, socket, command } = fixture({ isEnabled: () => true, debug });
    const pending = client.requestJson(command, { expectedEvents: [] });
    const receipt = emitCommandReceipt(socket, command);
    await expect(pending).resolves.toMatchObject({ data: receipt });
    expect(records).toHaveLength(2);
    expect(records.map(({ record }) => record.event)).toEqual([
      "frontend.agentTransport.commandSending",
      "frontend.agentTransport.commandSent",
    ]);
    for (const { type, record } of records) {
      expect(type).toBe(AGENT_TRANSPORT_DEBUG_TYPE);
      expect(record).toMatchObject({
        category: "debug",
        debugType: AGENT_TRANSPORT_DEBUG_TYPE,
        scope: "system",
        data: {
          targetIdentity: command.identity,
          commandId: command.commandId,
          commandType: command.commandType,
          transport: "websocket",
          messageLength: command.input.message.length,
        },
      });
      expect(JSON.stringify(record)).not.toContain(command.input.message);
      expect(record.data).not.toHaveProperty("input");
    }
    client.dispose();
  });

  it("does not construct a summary when diagnostics are disabled", async () => {
    const debug = vi.fn();
    const { client, socket, command } = fixture({ isEnabled: () => false, debug });
    let enumerationCount = 0;
    const observed = new Proxy(command, {
      ownKeys(target) {
        enumerationCount += 1;
        return Reflect.ownKeys(target);
      },
    });
    const pending = client.requestJson(observed, { expectedEvents: [] });
    expect(enumerationCount).toBe(1);
    expect(debug).not.toHaveBeenCalled();
    emitCommandReceipt(socket, command);
    await pending;
    client.dispose();
  });

  it.each(["isEnabled", "debug"])(
    "reports %s failures while preserving the successful command receipt",
    async (method) => {
      const failure = new Error("diagnostic sink failure");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const sink = { isEnabled: () => true, debug: (_type, build) => build() };
      sink[method] = () => {
        throw failure;
      };
      const { client, socket, command } = fixture(sink);
      const pending = client.requestJson(command, { expectedEvents: [] });
      expect(JSON.parse(socket.sent[0])).toEqual(command);
      const receipt = emitCommandReceipt(socket, command);
      await expect(pending).resolves.toMatchObject({ data: receipt });
      for (const event of ["commandSending", "commandSent"]) {
        expect(warn).toHaveBeenCalledWith(
          `[noobot:${AGENT_TRANSPORT_DEBUG_TYPE}] debug sink failed for frontend.agentTransport.${event}`,
          failure,
        );
      }
      client.dispose();
    },
  );

  it("preserves the transport failure when its diagnostic sink also fails", async () => {
    const diagnosticFailure = new Error("diagnostic sink failure");
    const transportFailure = new Error("socket send failure");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, socket, command } = fixture({
      isEnabled: () => true,
      debug: () => {
        throw diagnosticFailure;
      },
    });
    socket.send = () => {
      throw transportFailure;
    };
    await expect(client.requestJson(command, { expectedEvents: [] })).rejects.toBe(
      transportFailure,
    );
    expect(warn).toHaveBeenCalledWith(
      `[noobot:${AGENT_TRANSPORT_DEBUG_TYPE}] debug sink failed for frontend.agentTransport.commandSendFailed`,
      diagnosticFailure,
    );
    client.dispose();
  });
});
