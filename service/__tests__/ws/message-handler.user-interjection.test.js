/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
  createTurnInterjectionCommand,
} from "@noobot/agent-transport-protocol";
import { createMessageHandler } from "../../ws/chat-websocket/message-handler.js";
import {
  closeUserInterjectionQueue,
  registerActiveRun,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";

function createFixture() {
  const sent = [];
  const closed = [];
  const handle = registerActiveRun({
    userId: "interjection-owner",
    sessionId: "interjection-session",
    dialogProcessId: "interjection-dialog",
    turnScopeId: "interjection-turn",
  });
  const handler = createMessageHandler({
    state: {},
    authInfo: { userId: handle.userId },
    webSocket: { close: (...args) => closed.push(args) },
    sendEvent: (event, data) => sent.push({ event, data }),
    pendingInteractionRequests: new Map(),
  });
  const command = (commandId, message) =>
    createTurnInterjectionCommand({
      commandId,
      identity: {
        sessionId: handle.sessionId,
        parentSessionId: "",
        dialogProcessId: handle.dialogProcessId,
        parentDialogProcessId: "",
        turnScopeId: handle.turnScopeId,
      },
      interaction: { message },
    });
  return { sent, closed, handle, handler, command };
}

test("message handler enqueues user interjections and acknowledges the command", async () => {
  const fixture = createFixture();
  try {
    await fixture.handler(JSON.stringify(fixture.command("interjection-1", "first")));
    await fixture.handler(JSON.stringify(fixture.command("interjection-2", "second")));

    assert.deepEqual(
      fixture.handle.userInterjectionQueue.map((item) => item.message),
      ["first", "second"],
    );
    assert.deepEqual(
      fixture.sent.map(({ event, data }) => ({ event, outcome: data.outcome })),
      [
        {
          event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
          outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
        },
        {
          event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
          outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
        },
      ],
    );
    assert.deepEqual(fixture.closed, []);
  } finally {
    unregisterActiveRun(fixture.handle);
  }
});

test("message handler rejects interjections after stopping without closing the transport", async () => {
  const fixture = createFixture();
  try {
    closeUserInterjectionQueue(fixture.handle);
    await fixture.handler(JSON.stringify(fixture.command("interjection-after-stop", "late")));

    assert.deepEqual(fixture.handle.userInterjectionQueue, []);
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0].event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
    assert.equal(fixture.sent[0].data.outcome, AGENT_COMMAND_RECEIPT_OUTCOME.FAILED);
    assert.equal(fixture.sent[0].data.error.code, "active_turn_stopping");
    assert.deepEqual(fixture.closed, []);
  } finally {
    unregisterActiveRun(fixture.handle);
  }
});
