/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { createUserInterjectionContentFact } from "@noobot/event-protocol/thinking-detail-content";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

async function fixture(context) {
  const fixture = await createMessageCase(context, { transactionBytes: 16 * 1024 });
  const { journal, sessionId } = fixture;
  const messages = openTestMessages(journal, sessionId);
  const source = message(sessionId, "answer");
  await messages.commit(
    await prepare(journal, messages, "seed", {
      messages: [source],
      turnTransition: {
        ...scope,
        sessionId,
        commandId: "accept",
        causationId: "accept",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: source.presentationMessageId,
        executionId: "agent:turn-1",
        executionKind: "agent",
        rootExecutionId: "agent:turn-1",
      },
    }),
  );
  let sequence = 0;
  async function append(payload) {
    sequence += 1;
    const commandId = `event-${sequence}`;
    const envelope = createEventEnvelope({
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
      identity: {
        eventId: commandId,
        eventType: "message_event",
        sessionId,
        turnScopeId: scope.turnScopeId,
      },
      causality: { commandId, causationId: commandId },
      ordering: { domain: "message-event", scopeId: source.presentationMessageId, sequence },
      producer: { type: "agent", id: "test" },
      occurredAt: committedAt,
      payload: { ...scope, presentationMessageId: source.presentationMessageId, ...payload },
    });
    await messages.commit(
      await prepare(journal, messages, commandId, {
        artifactEvents: [{ eventId: commandId, envelope, committedAt, deliveries: {} }],
      }),
    );
  }
  const interject = async (text) => {
    const contentFact = createUserInterjectionContentFact({
      ...scope,
      sessionId,
      messageUid: `interjection-${sequence + 1}`,
      presentationMessageId: source.presentationMessageId,
      message: text,
      receivedAt: committedAt,
      sequence: sequence + 1,
    });
    await append({ eventType: MESSAGE_EVENT_TYPE.USER_INTERJECTION, contentFact });
    return contentFact;
  };
  const appendLargeEvents = async () => {
    for (let index = 0; index < 12; index += 1) {
      await append({
        eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_START,
        toolCallId: `call-${sequence + 1}`,
        tool: "read_file",
        args: { padding: randomBytes(2000).toString("hex") },
      });
    }
  };
  return { ...fixture, interject, appendLargeEvents };
}

const open = (journal, sessionId) =>
  openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
const displayPage = (reader) =>
  reader.readDisplayPage({ cursor: null, direction: "forward", limit: 1, maxBytes: 4096 });

test("display interjections scan bounded event windows and retain their snapshot across continuation and cold reopen", async (context) => {
  const { journal, sessionId, root, interject, appendLargeEvents } = await fixture(context);
  const previous = await interject("earlier instruction");
  await appendLargeEvents();
  {
    await using retained = await open(journal, sessionId);
    const latest = await interject("latest instruction");
    await appendLargeEvents();
    await using current = await open(journal, sessionId);
    const retainedProjection = await retained.readDisplayProjection();
    assert.deepEqual(retainedProjection.messages[0].thinkingContentTimeline, [previous]);
    const currentProjection = await current.readDisplayProjection();
    assert.deepEqual(currentProjection.messages[0].thinkingContentTimeline, [latest]);
    assert.deepEqual((await displayPage(retained)).messages[0].thinkingContentTimeline, [previous]);
    assert.deepEqual((await displayPage(current)).messages[0].thinkingContentTimeline, [latest]);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  context.after(() => cold.close());
  await using reader = await open(cold, sessionId);
  const projection = await reader.readDisplayProjection();
  assert.equal(projection.messages[0].thinkingContentTimeline[0].text, "latest instruction");
});

test("display remains readable when a long event history contains no user interjection", async (context) => {
  const { journal, sessionId, appendLargeEvents } = await fixture(context);
  await appendLargeEvents();
  await appendLargeEvents();
  await using reader = await open(journal, sessionId);
  const projection = await reader.readDisplayProjection();
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].content, "answer");
  assert.equal(Object.hasOwn(projection.messages[0], "thinkingContentTimeline"), false);
  assert.equal((await displayPage(reader)).messages.length, 1);
});
