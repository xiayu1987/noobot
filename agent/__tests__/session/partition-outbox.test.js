/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { preparePartitionOutboxRetirement } from "../../src/session/partition-storage/partition-outbox.js";
import { message } from "./partition-session-messages.test-helpers.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-19T00:00:00.000Z";
const consumerId = "runtime-events";
const turn = { dialogProcessId: "dialog-1", turnScopeId: "turn-1" };

async function fixture(t, options) {
  const context = await createTransactionCase(t, { transactionBytes: 16 * 1024 }, options);
  const { journal, sessionId } = context;
  await initializePartitionSession(journal, { sessionId, parentSessionId: "" }, committedAt);
  return { ...context, repository: open(journal, sessionId) };
}
function open(journal, sessionId) {
  return new PartitionSessionMessages(journal, { sessionId, parentSessionId: "" });
}
function prepare(journal, repository, operationId, changes) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, {
      operationId,
      committedAt,
      changes,
    }),
  );
}
async function accept(journal, repository, sessionId, ordinal) {
  return repository.commit(
    await prepare(journal, repository, `accept-${ordinal}`, {
      messages: [{ ...message(sessionId, `message-${ordinal}`), turnScopeId: `turn-${ordinal}` }],
      turnTransition: {
        ...turn,
        turnScopeId: `turn-${ordinal}`,
        sessionId,
        commandId: `accept-${ordinal}`,
        causationId: `accept-${ordinal}`,
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: `presentation-${ordinal}`,
        executionId: `agent:turn-${ordinal}`,
        executionKind: "agent",
        rootExecutionId: `agent:turn-${ordinal}`,
      },
    }),
  );
}
async function complete(journal, repository, sessionId, ordinal = 1) {
  const completionCommitId = `completed-${ordinal}`;
  for (const [eventType, phase, extra] of [
    ["turn.processing_started", "processing", {}],
    ["turn.processing_completed", "completion", { completionCommitId }],
    [
      "turn.completed",
      "completion",
      { commandId: completionCommitId, terminalStatus: { command: "completed" } },
    ],
  ]) {
    const committed = await repository.commit(
      await prepare(journal, repository, `${eventType}-${ordinal}`, {
        turnTransition: {
          ...turn,
          turnScopeId: `turn-${ordinal}`,
          sessionId,
          eventType,
          phase,
          commandId: `${eventType}-${ordinal}`,
          causationId: `${eventType}-${ordinal}`,
          ...extra,
        },
      }),
    );
    assert.equal(committed.result.turnTransition.applied, true);
  }
}
function acknowledgement(event) {
  return {
    type: "acknowledge",
    eventId: event.eventId,
    consumerId,
    deliveredAt: committedAt,
    orderingDomain: event.envelope.ordering.domain,
    orderingScopeId: event.envelope.ordering.scopeId,
    sequence: event.envelope.ordering.sequence,
  };
}
function page(journal, repository, query = {}) {
  return journal.usingSnapshot((snapshot) =>
    repository.readOutboxPage({ snapshot, consumerId, ...query }),
  );
}

const deletion = (turnScopeId, commandId = "delete-outbox-suffix") => ({
  messageDeletion: { commandId, anchor: { turnScopeId } },
});

test("partition ingress rejects independent outbox retirement without publishing", async (t) => {
  const { journal, repository } = await fixture(t);
  const before = structuredClone(journal.head);
  for (const changes of [
    { outboxTurnRemoval: { turnScopeIds: ["turn-1"] } },
    {
      sessionMetadata: { customTitle: "must not publish" },
      outboxTurnRemoval: { turnScopeIds: ["turn-1"] },
    },
    {
      sessionMetadata: { customTitle: "must not publish" },
      ["__proto__"]: null,
    },
  ]) {
    const operationId = "retired-outbox-command";
    const invalid = { code: "SESSION_COMMIT_INPUT_INVALID" };
    const prepared = await prepare(journal, repository, operationId, changes);
    await assert.rejects(repository.commit(prepared), invalid);
    assert.deepEqual(journal.head, before);
    await journal.usingSnapshot(({ epoch, sequence: expectedGeneration }) =>
      assert.rejects(
        repository.commit({
          epoch,
          expectedGeneration,
          operationId,
          input: { changes, committedAt },
        }),
        invalid,
      ),
    );
    assert.deepEqual(journal.head, before);
  }
});

test("an eventless lifecycle revision does not consume a delivery position", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const collection = "metadata";
    const key = "lifecycle";
    const header = (await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })).get(
      key,
    );
    const stored = (await transactions.getLatestMany({ snapshot, collection, keys: [key] })).get(
      key,
    );
    assert.equal(stored.value.outboxTail, 0);
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "advance-lifecycle-without-event",
      input: {},
      result: null,
      mutations: [
        {
          collection,
          key,
          owner: header.owner,
          value: { ...stored.value, sequence: 1 },
        },
      ],
    });
  });
  await journal.usingSnapshot(async (snapshot) => {
    const empty = await repository.readOutboxPage({ snapshot, consumerId });
    assert.equal(empty.cursor, 0);
    const { committedEvent } = (await accept(journal, repository, sessionId, 1)).result
      .turnTransition;
    const pending = await page(journal, repository);
    assert.equal(committedEvent.envelope.ordering.sequence, 2);
    assert.deepEqual(
      pending.events.map(({ ordinal }) => ordinal),
      [1],
    );
    assert.equal(pending.cursor, 1);
    assert.deepEqual(await repository.readOutboxPage({ snapshot, consumerId }), empty);
    await repository.commit(
      await prepare(journal, repository, "ack-after-lifecycle-gap", {
        deliveries: [acknowledgement(committedEvent)],
        outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
      }),
    );
    const delivered = await page(journal, repository);
    assert.equal(delivered.after, 1);
    assert.deepEqual(delivered.events, []);
  });
});

test("cursor advance rejects cross-page work and publishes acknowledgements one page at a time", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  const { limits } = await journal.usingSnapshot((snapshot) => snapshot);
  const cursor = limits.pageRecords + 1;
  for (const ordinal of [1, 2]) {
    await accept(journal, repository, sessionId, ordinal);
    await complete(journal, repository, sessionId, ordinal);
  }
  await accept(journal, repository, sessionId, 3);
  const first = await page(journal, repository);
  const last = await page(journal, repository, { after: first.cursor, limit: 1 });
  const deliveries = first.events.map(acknowledgement);
  const firstAdvance = { consumerId, expectedCursor: 0, cursor: first.cursor };
  const lastAdvance = { consumerId, expectedCursor: first.cursor, cursor };
  assert.equal(last.cursor, cursor);
  const before = structuredClone(journal.head);
  for (const [index, outboxCursors] of [
    [{ ...firstAdvance, cursor }],
    [firstAdvance, lastAdvance],
  ].entries()) {
    await assert.rejects(
      repository.commit(
        await prepare(journal, repository, `advance-over-budget-${index}`, {
          deliveries: [...deliveries, ...last.events.map(acknowledgement)],
          outboxCursors,
        }),
      ),
      { code: "SESSION_COMMIT_INPUT_INVALID" },
    );
    assert.deepEqual(journal.head, before);
  }
  await assert.rejects(
    repository.commit(
      await prepare(journal, repository, "advance-incomplete", {
        deliveries: deliveries.slice(0, -1),
        outboxCursors: [firstAdvance],
      }),
    ),
    { code: "SESSION_OUTBOX_CURSOR_UNDELIVERED", eventId: deliveries.at(-1).eventId },
  );
  assert.deepEqual(journal.head, before);
  assert.equal((await page(journal, repository)).events.length, limits.pageRecords);

  const request = await prepare(journal, repository, "advance-first-page", {
    deliveries,
    outboxCursors: [firstAdvance],
  });
  const committed = await repository.commit(request);
  assert.deepEqual(committed.result.outboxCursors, [{ consumerId, cursor: first.cursor }]);
  assert.deepEqual(await repository.commit(request), { ...committed, replayed: true });
  const pending = await page(journal, repository);
  assert.equal(pending.after, first.cursor);
  assert.deepEqual(pending.events, last.events);
  const { result } = await repository.commit(
    await prepare(journal, repository, "advance-last-page", {
      deliveries: last.events.map(acknowledgement),
      outboxCursors: [lastAdvance],
    }),
  );
  assert.deepEqual(result.outboxCursors, [{ consumerId, cursor }]);
  assert.equal((await page(journal, repository)).after, cursor);
});

test("turn removal preparation reads only selected range descriptors regardless of event history", async (t) => {
  const { journal } = await fixture(t);
  const snapshot = await journal.snapshot();
  for (const count of [10, 1000, 10000]) {
    const reads = [];
    const rangeOwner = { epoch: "fixture", sequence: 1 };
    const mutations = [];
    const result = await preparePartitionOutboxRetirement({
      view: {
        async getLatestMany({ collection, keys }) {
          reads.push({ collection, keys });
          assert.ok(
            ["metadata", "turnOutbox"].includes(collection),
            "must not read event bodies or positions",
          );
          return new Map(
            keys.map((key) => [
              key,
              {
                owner: rangeOwner,
                mutation: {
                  value:
                    collection === "metadata"
                      ? { outboxTail: count }
                      : {
                          turnScopeId: key,
                          lastOrdinal: count,
                          removedThrough: 0,
                          eventCount: count,
                        },
                },
              },
            ]),
          );
        },
      },
      mutations,
      snapshot,
      turnScopeIds: ["turn-1"],
    });
    assert.deepEqual(result, { removed: count });
    assert.deepEqual(reads, [
      { collection: "metadata", keys: ["lifecycle"] },
      { collection: "turnOutbox", keys: ["turn-1"] },
    ]);
    assert.deepEqual(mutations, [
      {
        collection: "turnOutbox",
        key: "turn-1",
        owner: rangeOwner,
        value: { turnScopeId: "turn-1", lastOrdinal: count, removedThrough: count, eventCount: 0 },
      },
    ]);
  }
});

test("partition delivery and cursor publish atomically, retain old snapshots and replay cold", async (t) => {
  const { journal, sessionId, repository, root } = await fixture(t);
  const accepted = await accept(journal, repository, sessionId, 1);
  const event = accepted.result.turnTransition.committedEvent;
  const pending = await page(journal, repository);
  assert.deepEqual(
    pending.events.map((entry) => entry.eventId),
    [event.eventId],
  );
  const request = await prepare(journal, repository, "deliver", {
    deliveries: [
      { type: "attempt", eventId: event.eventId, consumerId, attemptedAt: committedAt },
      acknowledgement(event),
    ],
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  let committed;
  await journal.usingSnapshot(async (snapshot) => {
    const publications = journal.work.publications;
    committed = await repository.commit(request);
    assert.equal(journal.work.publications, publications + 1);
    assert.equal(committed.result.deliveries[0].delivery.attempts, 1);
    assert.equal(committed.result.deliveries[1].delivery.status, "delivered");
    assert.equal(committed.result.deliveries[1].delivery.attempts, 1);
    assert.deepEqual(committed.result.outboxCursors, [{ consumerId, cursor: 1 }]);
    assert.deepEqual(await repository.readOutboxPage({ snapshot, consumerId }), pending);
    assert.deepEqual((await page(journal, repository)).events, []);
    assert.equal((await page(journal, repository)).after, 1);
    assert.equal((await page(journal, repository, { consumerId: "other" })).events.length, 1);
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened, sessionId);
  const before = reopened.head.sequence;
  assert.deepEqual(await cold.commit(request), { ...committed, replayed: true });
  assert.equal(reopened.head.sequence, before);
  assert.equal((await page(reopened, cold)).after, 1);
  const other = await page(reopened, cold, { consumerId: "other" });
  assert.equal(other.after, 0);
  assert.deepEqual(
    other.events.map(({ eventId }) => eventId),
    [event.eventId],
  );
  assert.deepEqual(other.events[0].deliveries.other, undefined);
  const conflict = await prepare(reopened, cold, "cursor-conflict", {
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  await assert.rejects(cold.commit(conflict), { code: "SESSION_OUTBOX_CURSOR_CONFLICT" });
  assert.equal(reopened.head.sequence, before);
  for (const [operationId, cursor] of [
    ["cursor-regression", 0],
    ["cursor-past-tail", pending.cursor + 1],
  ]) {
    await assert.rejects(
      async () => {
        const invalid = await prepare(reopened, cold, operationId, {
          outboxCursors: [{ consumerId, expectedCursor: 1, cursor }],
        });
        await cold.commit(invalid);
      },
      { code: "SESSION_COMMIT_INPUT_INVALID" },
    );
    assert.equal(reopened.head.sequence, before);
    const current = await page(reopened, cold);
    assert.equal(current.after, 1);
    assert.deepEqual(current.events, []);
  }
});

test("a cursor cannot skip pending events or publish a partial acknowledgement", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  const first = (await accept(journal, repository, sessionId, 1)).result.turnTransition
    .committedEvent;
  const before = journal.head.sequence;
  const request = await prepare(journal, repository, "skip", {
    sessionMetadata: { customTitle: "must not publish" },
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  await assert.rejects(repository.commit(request), { code: "SESSION_OUTBOX_CURSOR_UNDELIVERED" });
  assert.equal(journal.head.sequence, before);
  const bad = await prepare(journal, repository, "bad-ordering", {
    deliveries: [acknowledgement(first), { ...acknowledgement(first), sequence: 99 }],
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  await assert.rejects(repository.commit(bad), { code: "SESSION_COMMIT_INPUT_INVALID" });
  assert.equal(journal.head.sequence, before);
  assert.deepEqual((await page(journal, repository)).events[0].deliveries, {});
});

test("failed outbox publication preserves pending delivery and retries after reopen", async (t) => {
  const { journal, sessionId, repository, root } = await fixture(t, { autoClose: false });
  const event = (await accept(journal, repository, sessionId, 1)).result.turnTransition
    .committedEvent;
  const request = await prepare(journal, repository, "deliver-fault", {
    deliveries: [acknowledgement(event)],
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  const before = journal.head.sequence;
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target).endsWith("/CURRENT")) {
        injected = true;
        throw new Error("outbox publication fault");
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened, sessionId);
  assert.equal(reopened.head.sequence, before);
  assert.deepEqual((await page(reopened, cold)).events[0].deliveries, {});
  const committed = await cold.commit(request);
  assert.equal(committed.replayed, false);
  assert.equal(reopened.head.sequence, before + 1);
  assert.equal((await page(reopened, cold)).after, 1);
  assert.deepEqual((await page(reopened, cold)).events, []);
});

test("mixed lifecycle and delivery returns the new event receipt and pages its pending position", async (t) => {
  const { journal, sessionId, repository, root } = await fixture(t);
  const first = (await accept(journal, repository, sessionId, 1)).result.turnTransition
    .committedEvent;
  const request = await prepare(journal, repository, "start-and-deliver", {
    turnTransition: {
      ...turn,
      sessionId,
      commandId: "start",
      causationId: "start",
      eventType: "turn.processing_started",
      phase: "processing",
    },
    deliveries: [acknowledgement(first)],
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
  });
  const before = journal.work.publications;
  const committed = await repository.commit(request);
  assert.equal(journal.work.publications, before + 1);
  const next = committed.result.turnTransition.committedEvent;
  assert.notEqual(next.eventId, first.eventId);
  assert.equal(next.envelope.payload.eventType, "turn.processing_started");
  assert.equal(next.envelope.ordering.sequence, 2);
  assert.equal(committed.result.deliveries[0].eventId, first.eventId);
  const nextPage = await page(journal, repository);
  assert.equal(nextPage.after, 1);
  assert.deepEqual(
    nextPage.events.map(({ eventId, ordinal }) => [eventId, ordinal]),
    [[next.eventId, 2]],
  );
  const firstPage = await page(journal, repository, { after: 0, limit: 1 });
  assert.deepEqual(firstPage.events, []);
  assert.equal(firstPage.cursor, 1);
  assert.equal(firstPage.hasMore, true);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened, sessionId);
  assert.deepEqual(await cold.commit(request), { ...committed, replayed: true });
  assert.deepEqual(await page(reopened, cold), nextPage);
});

test("message deletion retires delivery, isolates snapshots and replays cold", async (t) => {
  const { journal, sessionId, repository, root } = await fixture(t);
  const first = (await accept(journal, repository, sessionId, 1)).result.turnTransition
    .committedEvent;
  await complete(journal, repository, sessionId);
  await accept(journal, repository, sessionId, 2);
  const request = await prepare(journal, repository, "delete-suffix", deletion("turn-1"));
  let committed;
  await journal.usingSnapshot(async (snapshot) => {
    const previous = await repository.readOutboxPage({ snapshot, consumerId });
    const publications = journal.work.publications;
    committed = await repository.commit(request);
    assert.equal(journal.work.publications, publications + 1);
    assert.equal(committed.result.messageDeletion.receipt.result.deletedCount, 2);
    assert.deepEqual(await repository.readOutboxPage({ snapshot, consumerId }), previous);
    assert.deepEqual((await page(journal, repository)).events, []);
    const other = await page(journal, repository, { consumerId: "other" });
    assert.deepEqual(other.events, []);
    const removedPage = await page(journal, repository, { after: 0, limit: 1 });
    assert.deepEqual(removedPage.events, []);
    assert.equal(removedPage.cursor, 1);
    assert.equal(removedPage.hasMore, true);
  });
  const before = journal.head.sequence;
  const removedDelivery = await prepare(journal, repository, "deliver-removed", {
    deliveries: [acknowledgement(first)],
  });
  await assert.rejects(repository.commit(removedDelivery), {
    code: "SESSION_OUTBOX_EVENT_MISSING",
  });
  assert.equal(journal.head.sequence, before);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened, sessionId);
  assert.deepEqual(await cold.commit(request), { ...committed, replayed: true });
  assert.equal(reopened.head.sequence, before);
  assert.equal((await page(reopened, cold)).after, 0);
  const again = await cold.commit(
    await prepare(reopened, cold, "delete-again", deletion("turn-1")),
  );
  assert.equal(again.result.messageDeletion.deduplicated, true);
});

test("deleting a later turn does not permit skipping retained pending events", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  await accept(journal, repository, sessionId, 1);
  await complete(journal, repository, sessionId);
  await accept(journal, repository, sessionId, 2);
  await repository.commit(await prepare(journal, repository, "delete-later", deletion("turn-2")));
  const before = journal.head.sequence;
  const request = await prepare(journal, repository, "remove-and-skip", {
    sessionMetadata: { customTitle: "must not publish" },
    outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 5 }],
  });
  await assert.rejects(repository.commit(request), { code: "SESSION_OUTBOX_CURSOR_UNDELIVERED" });
  assert.equal(journal.head.sequence, before);
  assert.equal((await page(journal, repository)).events.length, 4);
});

test("message deletion prevents later lifecycle events from reviving retired delivery", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  await accept(journal, repository, sessionId, 1);
  await repository.commit(await prepare(journal, repository, "remove-prefix", deletion("turn-1")));
  await assert.rejects(
    repository.commit(
      await prepare(journal, repository, "start-after-removal", {
        turnTransition: {
          ...turn,
          sessionId,
          commandId: "start",
          causationId: "start",
          eventType: "turn.processing_started",
          phase: "processing",
        },
      }),
    ),
    { code: "SESSION_TURN_IDENTITY_CONFLICT" },
  );
  assert.deepEqual((await page(journal, repository)).events, []);
});

test("a lifecycle event is retired with its message in one publication", async (t) => {
  const { journal, sessionId, repository } = await fixture(t);
  await accept(journal, repository, sessionId, 1);
  await repository.commit(
    await prepare(journal, repository, "start", {
      turnTransition: {
        ...turn,
        sessionId,
        commandId: "start",
        causationId: "start",
        eventType: "turn.processing_started",
        phase: "processing",
      },
    }),
  );
  const before = journal.work.publications;
  const committed = await repository.commit(
    await prepare(journal, repository, "delete-started", deletion("turn-1")),
  );
  assert.equal(journal.work.publications, before + 1);
  assert.equal(committed.result.messageDeletion.receipt.result.deletedCount, 1);
  assert.deepEqual((await page(journal, repository)).events, []);
});

test("failed turn removal preserves visibility and retries atomically after reopening", async (t) => {
  const { journal, sessionId, repository, root } = await fixture(t, { autoClose: false });
  await accept(journal, repository, sessionId, 1);
  const request = await prepare(journal, repository, "remove-fault", {
    ...deletion("turn-1"),
  });
  const before = journal.head.sequence;
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target).endsWith("/CURRENT")) {
        injected = true;
        throw new Error("turn removal publication fault");
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = open(reopened, sessionId);
  assert.equal(reopened.head.sequence, before);
  assert.equal((await page(reopened, cold)).events.length, 1);
  const committed = await cold.commit(request);
  assert.equal(committed.replayed, false);
  assert.equal(committed.result.messageDeletion.receipt.result.deletedCount, 1);
  assert.deepEqual((await page(reopened, cold)).events, []);
  assert.deepEqual(await cold.commit(request), { ...committed, replayed: true });
});

for (const [name, collection, key, corrupt] of [
  ["missing turn range", "turnOutbox", () => "turn-1", () => null],
  ["turn range count", "turnOutbox", () => "turn-1", (value) => ({ ...value, eventCount: 2 })],
  [
    "turn range ownership",
    "turnOutbox",
    () => "turn-1",
    (value) => ({ ...value, turnScopeId: "foreign" }),
  ],
  [
    "parent ownership",
    "events",
    (event) => event.eventId,
    (value) => {
      value.envelope.payload.parentSessionId = "foreign";
      return value;
    },
  ],
  [
    "consumer delivery",
    "events",
    (event) => event.eventId,
    (value) => {
      value.deliveries.other = { attempts: -1 };
      return value;
    },
  ],
  ["event order", "eventOrder", () => "1", () => "missing-event"],
  ["cursor", "outboxConsumers", () => consumerId, () => ({ consumerId, cursor: 2 })],
]) {
  test(`partition outbox rejects persisted invalid ${name} without publishing`, async (t) => {
    const { journal, sessionId, repository } = await fixture(t, { autoClose: false });
    const event = (await accept(journal, repository, sessionId, 1)).result.turnTransition
      .committedEvent;
    const transactions = new PartitionTransactions(journal);
    await journal.usingSnapshot(async (snapshot) => {
      const previous = (
        await transactions.getLatestMany({ snapshot, collection, keys: [key(event)] })
      ).get(key(event));
      const entry = (
        await transactions.lookupLatestMany({ snapshot, collection, keys: [key(event)] })
      ).get(key(event));
      await commitFixtureTransaction(transactions, {
        epoch: snapshot.epoch,
        expectedGeneration: snapshot.sequence,
        sequence: snapshot.sequence + 1,
        operationId: "corrupt",
        input: {},
        result: null,
        mutations: [
          {
            collection,
            key: key(event),
            owner: entry?.owner ?? null,
            value: corrupt(structuredClone(previous?.value)),
          },
        ],
      });
    });
    const before = journal.head.sequence;
    await assert.rejects(page(journal, repository), { code: "SESSION_STORAGE_CORRUPT" });
    const request = await prepare(journal, repository, "advance-corrupt", {
      sessionMetadata: { customTitle: "must not publish" },
      outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }],
    });
    await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.head.sequence, before);
  });
}

for (const invalidRange of [
  null,
  { turnScopeId: "foreign", lastOrdinal: 1, removedThrough: 0, eventCount: 1 },
]) {
  for (const operation of ["append", "remove"]) {
    test(`cold ${operation} rejects ${invalidRange === null ? "missing" : "foreign"} turn range without repairing it`, async (t) => {
      const { journal, sessionId, repository, root } = await fixture(t);
      await accept(journal, repository, sessionId, 1);
      const transactions = new PartitionTransactions(journal);
      await journal.usingSnapshot(async (snapshot) => {
        const collection = "turnOutbox";
        const key = turn.turnScopeId;
        const entry = (
          await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })
        ).get(key);
        await commitFixtureTransaction(transactions, {
          epoch: snapshot.epoch,
          expectedGeneration: snapshot.sequence,
          sequence: snapshot.sequence + 1,
          operationId: "corrupt-range",
          input: {},
          mutations: [{ collection, key, owner: entry.owner, value: invalidRange }],
          result: null,
        });
      });
      await journal.close();
      const reopened = await PartitionJournal.open({ root, sessionId });
      const cold = open(reopened, sessionId);
      const before = structuredClone(reopened.head);
      const changes =
        operation === "remove"
          ? deletion(turn.turnScopeId)
          : {
              turnTransition: {
                ...turn,
                sessionId,
                commandId: "start",
                causationId: "start",
                eventType: "turn.processing_started",
                phase: "processing",
              },
            };
      const request = await prepare(reopened, cold, operation, {
        ...changes,
      });
      await assert.rejects(cold.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
      await assert.rejects(reopened.close(), { code: "SESSION_STORAGE_CORRUPT" });
      assert.deepEqual(reopened.head, before);
      const verified = await PartitionJournal.open({ root, sessionId });
      t.after(() => verified.close());
      assert.deepEqual(verified.head, before);
      await verified.usingSnapshot(async (snapshot) => {
        const values = await new PartitionTransactions(verified).getLatestMany({
          snapshot,
          collection: "turnOutbox",
          keys: [turn.turnScopeId],
        });
        assert.deepEqual(values.get(turn.turnScopeId).value, invalidRange);
      });
    });
  }
}
