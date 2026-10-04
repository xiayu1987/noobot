/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  AGENT_TRANSPORT_PROTOCOL_VERSION,
} from "@noobot/agent-transport-protocol";
import { sendFailedCommandReceipt } from "../../ws/chat-websocket/command-receipt.js";
import { createMessageHandler } from "../../ws/chat-websocket/message-handler.js";

function createRecorder() {
  const sent = [];
  const sendEvent = (event, data) => {
    sent.push({ event, data });
    return true;
  };
  return { sent, sendEvent };
}

const validCommand = Object.freeze({
  commandId: " cmd-1 ",
  commandType: AGENT_COMMAND.STOP,
  identity: { sessionId: "session-1", turnScopeId: "turn-1", dialogProcessId: "dialog-1" },
});

test("sendFailedCommandReceipt sends a failed receipt for a complete command", () => {
  const { sent, sendEvent } = createRecorder();
  const result = sendFailedCommandReceipt(sendEvent, validCommand, {
    code: " stop_not_allowed ",
    message: "not allowed",
  });
  assert.equal(result, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
  const receipt = sent[0].data;
  assert.equal(receipt.commandId, "cmd-1");
  assert.equal(receipt.commandType, AGENT_COMMAND.STOP);
  assert.equal(receipt.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
  assert.deepEqual(receipt.identity, {
    sessionId: "session-1",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
  });
  assert.deepEqual(receipt.error, { code: "stop_not_allowed", message: "not allowed" });
  assert.ok(Object.isFrozen(receipt));
});

test("sendFailedCommandReceipt falls back to default error code and message", () => {
  const { sent, sendEvent } = createRecorder();
  assert.equal(sendFailedCommandReceipt(sendEvent, validCommand), true);
  assert.deepEqual(sent[0].data.error, { code: "command_failed", message: "command failed" });
  assert.equal(sendFailedCommandReceipt(sendEvent, validCommand, { code: "only_code" }), true);
  assert.deepEqual(sent[1].data.error, { code: "only_code", message: "only_code" });
});

test("sendFailedCommandReceipt returns false without throwing when sessionId is missing", () => {
  const { sent, sendEvent } = createRecorder();
  const command = { ...validCommand, identity: { sessionId: "  " } };
  assert.equal(sendFailedCommandReceipt(sendEvent, command, { code: "x" }), false);
  assert.equal(sent.length, 0);
});

test("sendFailedCommandReceipt returns false without throwing when commandId is missing", () => {
  const { sent, sendEvent } = createRecorder();
  assert.equal(sendFailedCommandReceipt(sendEvent, { ...validCommand, commandId: "" }), false);
  assert.equal(sendFailedCommandReceipt(sendEvent, null), false);
  assert.equal(sent.length, 0);
});

function createRejectingHandler() {
  const { sent, sendEvent } = createRecorder();
  const closed = [];
  const handler = createMessageHandler({
    state: {},
    authInfo: { userId: "receipt-owner" },
    webSocket: { close: (...args) => closed.push(args) },
    sendEvent,
    translateText: (key) => key,
    normalizeLocale: (value) => value,
  });
  return { handler, sent, closed };
}

test("message handler sends a failed receipt for a rejected command with valid envelope", async () => {
  const { handler, sent, closed } = createRejectingHandler();
  await handler(
    JSON.stringify({
      protocolVersion: AGENT_TRANSPORT_PROTOCOL_VERSION,
      commandId: "cmd-envelope-ok",
      commandType: AGENT_COMMAND.STOP,
      identity: { sessionId: "session-1" },
      unexpected: true,
    }),
  );
  assert.equal(closed.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
  assert.equal(sent[0].data.commandId, "cmd-envelope-ok");
  assert.equal(sent[0].data.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
});

test("message handler closes the socket when the rejected command lacks ids", async () => {
  const { handler, sent, closed } = createRejectingHandler();
  await handler(
    JSON.stringify({
      protocolVersion: AGENT_TRANSPORT_PROTOCOL_VERSION,
      commandType: AGENT_COMMAND.STOP,
      identity: {},
    }),
  );
  await handler("not-json");
  assert.equal(sent.length, 0);
  assert.deepEqual(closed, [
    [1008, "invalid request"],
    [1008, "invalid request"],
  ]);
});
