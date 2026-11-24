/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorityOutboxPositionKey } from "@noobot/event-protocol/outbox";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const consumerId = "runtime-events";
const open = (journal, sessionId) =>
  openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });

async function fixture(t, options) {
  const result = await createMessageCase(t, { transactionBytes: 16 * 1024 }, options);
  const { journal, sessionId } = result;
  const messages = openTestMessages(journal, sessionId);
  const turnTransition = {
    ...scope,
    sessionId,
    commandId: "accept",
    causationId: "accept",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation-1",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
  const committed = await messages.commit(
    await prepare(journal, messages, "accept", {
      messages: [message(sessionId, "message-1")],
      turnTransition,
    }),
  );
  return {
    ...result,
    messages,
    turnTransition,
    eventId: committed.result.turnTransition.committedEvent.eventId,
  };
}

test("single event reads agree with paging and preserve delivery revisions across snapshots", async (t) => {
  const { journal, sessionId, messages, eventId } = await fixture(t);
  await using previous = await open(journal, sessionId);
  const event = await previous.readOutboxEvent(eventId);
  assert.deepEqual((await previous.readOutboxPage({ consumerId })).events, [event]);
  assert.equal(await previous.readOutboxEvent("missing-event"), null);
  await messages.commit(
    await previous.prepareRequest({
      operationId: "acknowledge",
      committedAt,
      changes: {
        deliveries: [
          {
            type: "acknowledge",
            consumerId,
            eventId,
            deliveredAt: committedAt,
            orderingDomain: event.envelope.ordering.domain,
            orderingScopeId: event.envelope.ordering.scopeId,
            sequence: event.envelope.ordering.sequence,
          },
        ],
      },
    }),
  );
  assert.deepEqual(await previous.readOutboxEvent(eventId), event);
  await using current = await open(journal, sessionId);
  const delivered = await current.readOutboxEvent(eventId);
  assert.equal(delivered.deliveries[consumerId].deliveredAt, committedAt);
  assert.deepEqual((await current.readOutboxPage({ consumerId })).events, []);
});

test("retired events disappear from point reads without altering a retained reader or reviving after cold replay", async (t) => {
  const { journal, sessionId, root, messages, eventId } = await fixture(t);
  const previous = await open(journal, sessionId);
  const event = await previous.readOutboxEvent(eventId);
  const deletion = await previous.prepareRequest({
    operationId: "delete-turn",
    committedAt,
    changes: {
      messageDeletion: { commandId: "delete-turn", anchor: { turnScopeId: scope.turnScopeId } },
    },
  });
  await messages.commit(deletion);
  assert.deepEqual(await previous.readOutboxEvent(eventId), event);
  await using current = await open(journal, sessionId);
  assert.equal(await current.readOutboxEvent(eventId), null);
  assert.deepEqual((await current.readOutboxPage({ consumerId })).events, []);
  await previous.close();
  await current.close();
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const replayed = await openTestMessages(reopened, sessionId).commit(deletion);
  assert.equal(replayed.replayed, true);
  await using cold = await open(reopened, sessionId);
  assert.equal(await cold.readOutboxEvent(eventId), null);
});

test("a single event read rejects an ordinal index that points at another event", async (t) => {
  const { journal, sessionId, eventId } = await fixture(t);
  const transactions = new PartitionTransactions(journal);
  await using reader = await open(journal, sessionId);
  const event = await reader.readOutboxEvent(eventId);
  await journal.usingSnapshot(async (snapshot) => {
    const collection = "eventOrder";
    const key = authorityOutboxPositionKey(event.ordinal);
    const entry = (await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })).get(
      key,
    );
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "corrupt-order",
      input: {},
      result: null,
      mutations: [{ collection, key, owner: entry.owner, value: "foreign-event" }],
    });
  });
  await using current = await open(journal, sessionId);
  await assert.rejects(current.readOutboxEvent(eventId), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(await reader.readOutboxEvent(eventId), event);
});

for (const [type, damage] of [
  ["attempt", "foreign"],
  ["acknowledge", "foreign"],
  ["lifecycle-replay", "foreign"],
  ["lifecycle-replay", "missing"],
  ["lifecycle-replay", "beyond-tail"],
]) {
  test(`${type} rejects ${damage} committed event position before publishing`, async (t) => {
    const { journal, sessionId, messages, eventId, root, turnTransition } = await fixture(t, {
      autoClose: false,
    });
    const transactions = new PartitionTransactions(journal);
    const event = await journal.usingSnapshot((snapshot) =>
      messages.readOutboxEvent({ snapshot, eventId }),
    );
    await journal.usingSnapshot(async (snapshot) => {
      const collection = damage === "beyond-tail" ? "events" : "eventOrder";
      const key = damage === "beyond-tail" ? eventId : authorityOutboxPositionKey(event.ordinal);
      const entry = (
        await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })
      ).get(key);
      await commitFixtureTransaction(transactions, {
        epoch: snapshot.epoch,
        expectedGeneration: snapshot.sequence,
        sequence: snapshot.sequence + 1,
        operationId: "corrupt-order",
        input: {},
        result: null,
        mutations: [
          {
            collection,
            key,
            owner: entry.owner,
            value:
              damage === "beyond-tail"
                ? { ...entry.value, ordinal: event.ordinal + 1 }
                : damage === "missing"
                  ? null
                  : "foreign-event",
          },
        ],
      });
    });
    const before = structuredClone(journal.head);
    const request = await prepare(journal, messages, type, {
      sessionMetadata: { customTitle: "must not publish" },
      ...(type === "lifecycle-replay"
        ? { turnTransition }
        : {
            deliveries: [
              {
                type,
                consumerId,
                eventId,
                attemptedAt: committedAt,
                deliveredAt: committedAt,
                orderingDomain: event.envelope.ordering.domain,
                orderingScopeId: event.envelope.ordering.scopeId,
                sequence: event.envelope.ordering.sequence,
              },
            ],
          }),
    });
    await assert.rejects(messages.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    assert.deepEqual(journal.head, before);
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => assert.rejects(cold.close(), { code: "SESSION_STORAGE_CORRUPT" }));
    assert.deepEqual(cold.head, before);
    await using reader = await open(cold, sessionId);
    await assert.rejects(reader.readOutboxEvent(eventId), { code: "SESSION_STORAGE_CORRUPT" });
    await assert.rejects(openTestMessages(cold, sessionId).commit(request), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    assert.deepEqual(cold.head, before);
  });
}
