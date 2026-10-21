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
  attachRunTransport,
  closeUserInterjectionQueue,
  registerActiveRun,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";
import { createUserInterjectionAuthorityBridge } from "../../ws/chat-websocket/user-interjection-authority-bridge.js";
import { createEventEnvelope } from "@noobot/event-protocol";
import { MESSAGE_IDENTITY_FIELD } from "@noobot/session-protocol/message-identity";
import { MESSAGE_FIELD_SCHEMA } from "@noobot/session-protocol/message-identity-schema";

function createFixture() {
  const sent = [];
  const closed = [];
  const outbox = [];
  const committed = [];
  let authoritySequence = 0;
  const handle = registerActiveRun({
    userId: "interjection-owner",
    sessionId: "interjection-session",
    dialogProcessId: "interjection-dialog",
    turnScopeId: "interjection-turn",
    presentationMessageId: "interjection-assistant",
  });
  const sendEvent = (event, data) => {
    sent.push({ event, data });
    return true;
  };
  attachRunTransport(handle, sendEvent);
  const bot = {
    session: {
      async commitAuthorityEvent(input = {}) {
        authoritySequence += 1;
        const envelope = createEventEnvelope({
          ...input,
          identity: {
            ...input.identity,
            eventId: `interjection-event-${authoritySequence}`,
            sessionId: input.sessionId,
          },
          ordering: { ...input.ordering, sequence: authoritySequence },
          occurredAt: `2026-09-18T01:00:0${authoritySequence}.000Z`,
        });
        outbox.push(envelope);
        committed.push(envelope);
        return { committed: true, envelope };
      },
    },
  };
  const commitUserInterjection = createUserInterjectionAuthorityBridge({
    resolveBot: () => bot,
    persistenceScope: null,
  });
  const handler = createMessageHandler({
    state: {},
    authInfo: { userId: handle.userId },
    webSocket: { close: (...args) => closed.push(args) },
    sendEvent,
    commitUserInterjection,
    dispatchAuthorityEvents: async (_identity, publish) => {
      const pending = outbox.splice(0);
      for (const envelope of pending) {
        await publish(envelope.identity.eventType, envelope);
      }
      return { dispatched: true, delivered: pending.length };
    },
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
  return { sent, closed, committed, handle, handler, command };
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
    const sessionMessagePrefix = MESSAGE_FIELD_SCHEMA[MESSAGE_IDENTITY_FIELD.SESSION].prefix;
    const queue = fixture.handle.userInterjectionQueue;
    const queuedUids = queue.map((item) => item[MESSAGE_IDENTITY_FIELD.SESSION]);
    queuedUids.forEach((uid, index) => {
      assert.ok(uid.startsWith(sessionMessagePrefix));
      assert.equal(uid.includes(queue[index].commandId), false);
    });
    assert.deepEqual(
      fixture.sent.map(({ event, data }) => ({
        event,
        outcome: data.outcome,
        contentFact: data.payload?.contentFact,
      })),
      [
        {
          event: "message_event",
          outcome: undefined,
          contentFact: {
            contentId: `message:${queuedUids[0]}`,
            contentKind: "user_interjection",
            sourceMessageUid: queuedUids[0],
            text: "first",
            timestamp: queue[0].receivedAt,
            sequence: 1,
            sessionId: "interjection-session",
            dialogProcessId: "interjection-dialog",
            turnScopeId: "interjection-turn",
            presentationMessageId: "interjection-assistant",
          },
        },
        {
          event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
          outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
          contentFact: undefined,
        },
        {
          event: "message_event",
          outcome: undefined,
          contentFact: {
            contentId: `message:${queuedUids[1]}`,
            contentKind: "user_interjection",
            sourceMessageUid: queuedUids[1],
            text: "second",
            timestamp: queue[1].receivedAt,
            sequence: 2,
            sessionId: "interjection-session",
            dialogProcessId: "interjection-dialog",
            turnScopeId: "interjection-turn",
            presentationMessageId: "interjection-assistant",
          },
        },
        {
          event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
          outcome: AGENT_COMMAND_RECEIPT_OUTCOME.COMPLETED,
          contentFact: undefined,
        },
      ],
    );

    assert.deepEqual(
      fixture.committed.map((envelope) => ({
        hasMessageId: Object.hasOwn(envelope.identity, "messageId"),
        scopeId: envelope.ordering.scopeId,
      })),
      [
        { hasMessageId: false, scopeId: "interjection-assistant" },
        { hasMessageId: false, scopeId: "interjection-assistant" },
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
