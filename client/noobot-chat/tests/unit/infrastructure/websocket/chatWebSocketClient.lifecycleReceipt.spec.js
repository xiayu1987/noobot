/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatWebSocketClient } from "../../../../src/infrastructure/websocket/chatWebSocketClient.js";
import { setTransportDiagnosticsLogSink } from "../../../../src/modules/debug/loggers/transportDiagnosticsLogger.js";
import {
  emitCommandReceipt,
  MockWebSocket,
  setupWebSocketTestHooks,
  streamCommand,
  turnLifecycleProtocolEvent,
} from "./chatWebSocketClientTestFixtures.js";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";

setupWebSocketTestHooks();

const IDENTITY = { sessionId: "session-receipt", turnScopeId: "turn-receipt" };
const RECEIPT_EVENT = "frontend.websocket.lifecycleReceipt";

function lifecycle(eventId = "event-receipt") {
  return createTurnLifecycleEnvelope({
    eventType: TURN_EVENT.PROCESSING_STARTED,
    eventId,
    commandId: "command-receipt",
    ...IDENTITY,
    messageId: "message-receipt",
    presentationMessageId: "assistant-receipt",
    dialogProcessId: "dialog-receipt",
    revision: 2,
    sequence: 2,
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  });
}

function setup({ enabled = true } = {}) {
  const entries = [];
  const debug = vi.fn((debugType, factory) => {
    entries.push(factory());
    return true;
  });
  setTransportDiagnosticsLogSink({
    debug,
    isEnabled: (type) => enabled && type === "transport-diagnostics",
  });
  const client = createChatWebSocketClient({ resolveWebSocketUrl: () => "ws://test" });
  const payload = streamCommand(IDENTITY);
  const streamPromise = client.stream(payload, vi.fn());
  const socket = MockWebSocket.instances[0];
  const receiptLogs = () => entries.filter((entry) => entry.event === RECEIPT_EVENT);
  const finish = async () => {
    emitCommandReceipt(socket, payload);
    await streamPromise;
  };
  return { socket, debug, receiptLogs, finish };
}

describe("chatWebSocketClient lifecycle receipt diagnostics", () => {
  afterEach(() => setTransportDiagnosticsLogSink(null));

  it("records a transport-diagnostics debug entry with socket state when the receipt is sent", async () => {
    const { socket, receiptLogs, finish } = setup();
    socket.bufferedAmount = 12;
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(lifecycle()));

    expect(receiptLogs()).toHaveLength(1);
    const [entry] = receiptLogs();
    expect(entry.category).toBe("debug");
    expect(entry.debugType).toBe("transport-diagnostics");
    expect(entry.sessionId).toBe("session-receipt");
    expect(entry.turnScopeId).toBe("turn-receipt");
    expect(entry.data).toMatchObject({
      eventId: "event-receipt",
      eventType: TURN_EVENT.PROCESSING_STARTED,
      readyState: MockWebSocket.OPEN,
      bufferedAmount: 12,
      isCurrentTransport: true,
      result: "sent",
    });
    await finish();
  });

  it("exposes a non-OPEN socket even though send does not throw", async () => {
    const { socket, receiptLogs, finish } = setup();
    socket.readyState = MockWebSocket.CLOSING;
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(lifecycle()));

    expect(receiptLogs()[0].data).toMatchObject({
      readyState: MockWebSocket.CLOSING,
      result: "sent",
    });
    socket.readyState = MockWebSocket.OPEN;
    await finish();
  });

  it("records send_failed with the error when send throws", async () => {
    const { socket, receiptLogs, finish } = setup();
    const originalSend = socket.send.bind(socket);
    socket.send = (raw) => {
      if (String(raw).includes("turn.lifecycle.received")) {
        const error = new Error("socket not open");
        error.name = "InvalidStateError";
        throw error;
      }
      return originalSend(raw);
    };
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(lifecycle()));

    expect(receiptLogs()[0].data).toMatchObject({
      result: "send_failed",
      errorType: "InvalidStateError",
      errorMessage: "socket not open",
    });
    await finish();
  });

  it("records rejected with validation reasons for an invalid lifecycle envelope", async () => {
    const { socket, receiptLogs, finish } = setup();
    const invalid = { ...lifecycle(), eventType: "turn.unknown" };
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(invalid));

    const rejected = receiptLogs().filter((entry) => entry.data.result === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].data.reasons.length).toBeGreaterThan(0);
    expect(
      socket.sent
        .map((raw) => JSON.parse(raw))
        .filter((item) => item.action === "turn.lifecycle.received"),
    ).toHaveLength(0);
    await finish();
  });

  it("does not build entries or read socket state when the debug switch is off", async () => {
    const { socket, debug, finish } = setup({ enabled: false });
    const bufferedAmountRead = vi.fn(() => 0);
    Object.defineProperty(socket, "bufferedAmount", {
      configurable: true,
      get: bufferedAmountRead,
    });
    socket.emit("turn_lifecycle", turnLifecycleProtocolEvent(lifecycle()));

    expect(debug).not.toHaveBeenCalled();
    expect(bufferedAmountRead).not.toHaveBeenCalled();
    expect(
      socket.sent
        .map((raw) => JSON.parse(raw))
        .filter((item) => item.action === "turn.lifecycle.received"),
    ).toHaveLength(1);
    await finish();
  });
});
