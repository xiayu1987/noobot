/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  PARTITION_MESSAGE_PAGE,
  partitionMessageEntryKey,
  requirePartitionMessagePage,
} from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

test("the session order preserves interleaved turns across snapshots and reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const b = { ...message(sessionId, "b"), turnScopeId: "turn-2" };
  const first = await prepare(journal, repository, "first", {
    messages: [message(sessionId, "a"), b],
  });
  const result = await repository.commit(first);
  const page = (reader, snapshot, cursor = null) =>
    reader.readSessionMessageOrderPage({ snapshot, cursor, limit: 2 });
  await journal.usingSnapshot(async (snapshot) => {
    const next = await prepare(journal, repository, "second", {
      messages: [message(sessionId, "c")],
    });
    await repository.commit(next);
    assert.deepEqual(await page(repository, snapshot), { entries: ["a", "b"], nextCursor: null });
    const turn = await repository.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
    assert.deepEqual(
      turn.entries.map(({ sessionOrdinal }) => sessionOrdinal),
      [1],
    );
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(first), { ...result, replayed: true });
  await reopened.usingSnapshot(async (snapshot) => {
    const firstPage = await page(reader, snapshot);
    assert.deepEqual(firstPage.entries, ["a", "b"]);
    assert.ok(firstPage.nextCursor);
    assert.deepEqual(await page(reader, snapshot, firstPage.nextCursor), {
      entries: ["c"],
      nextCursor: null,
    });
    const turnPage = (cursor) => reader.readTurnPage({ snapshot, ...scope, cursor, limit: 1 });
    const firstTurnPage = await turnPage(null);
    assert.equal(firstTurnPage.entries[0].sessionOrdinal, 1);
    assert.ok(firstTurnPage.nextCursor);
    const secondTurnPage = await turnPage(firstTurnPage.nextCursor);
    assert.equal(secondTurnPage.entries[0].message.messageUid, "c");
    assert.equal(secondTurnPage.entries[0].sessionOrdinal, 3);
    assert.equal(secondTurnPage.nextCursor, null);
  });
});

test("full suffix pages follow interleaved session order and pin the publication", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { pageRecords: 1 });
  const repository = openTestMessages(journal, sessionId);
  for (const entry of [
    message(sessionId, "retained"),
    { ...message(sessionId, "anchor"), turnScopeId: "turn-2" },
    message(sessionId, "interleaved"),
  ]) {
    await repository.commit(
      await prepare(journal, repository, `seed-${entry.messageUid}`, { messages: [entry] }),
    );
  }
  const read = (snapshot, cursor = null, turnScopeId = "turn-2") =>
    repository.readMessageSuffixPage({ snapshot, turnScopeId, cursor, limit: 1 });
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal(await read(snapshot, null, "missing"), null);
    const { nextCursor, ...first } = await read(snapshot);
    assert.deepEqual(first, {
      messageSuffix: {
        firstOrdinal: 2,
        previousMessageCount: 3,
      },
      predecessor: { sessionId, epoch: snapshot.epoch, generation: snapshot.sequence },
      anchor: {
        dialogProcessId: scope.dialogProcessId,
        turnScopeId: "turn-2",
        messageUid: "anchor",
      },
      entries: ["anchor"],
    });
    assert.ok(nextCursor);
    await repository.commit(
      await prepare(journal, repository, "append", {
        messages: [message(sessionId, "later")],
      }),
    );
    assert.deepEqual(await read(snapshot, nextCursor), {
      ...first,
      entries: ["interleaved"],
      nextCursor: null,
    });
    await assert.rejects(read(snapshot, { ...nextCursor, after: 2 }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    await journal.usingSnapshot(async (latest) => {
      await assert.rejects(read(latest, nextCursor), { code: "SESSION_PAGE_CURSOR_CONFLICT" });
      const current = await read(latest);
      assert.deepEqual(current.messageSuffix, {
        ...first.messageSuffix,
        previousMessageCount: 4,
      });
      assert.deepEqual(current.predecessor, {
        sessionId,
        epoch: latest.epoch,
        generation: latest.sequence,
      });
    });
  });
});

for (const [position, uid] of [
  [1, "next"],
  [2, "anchor"],
]) {
  test(`a suffix continuation rejects a mismatched global position ${position} after reopen`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t);
    const repository = openTestMessages(journal, sessionId);
    await repository.commit(
      await prepare(journal, repository, "seed-suffix", {
        messages: [message(sessionId, "anchor"), message(sessionId, "next")],
      }),
    );
    const transactions = new PartitionTransactions(journal);
    const collection = PARTITION_MESSAGE_COLLECTIONS.sessionOrder;
    const key = partitionMessageEntryKey(collection, sessionId, position);
    await journal.usingSnapshot(async (snapshot) => {
      const entries = await transactions.lookupLatestMany({ snapshot, collection, keys: [key] });
      await commitFixtureTransaction(transactions, {
        epoch: snapshot.epoch,
        expectedGeneration: snapshot.sequence,
        sequence: snapshot.sequence + 1,
        operationId: "publish-wrong-position",
        input: {},
        mutations: [{ collection, key, owner: entries.get(key).owner, value: uid }],
        result: null,
      });
    });
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = openTestMessages(reopened, sessionId);
    await reopened.usingSnapshot(async (snapshot) => {
      const read = (cursor) =>
        reader.readMessageSuffixPage({
          snapshot,
          turnScopeId: scope.turnScopeId,
          cursor,
          limit: 1,
        });
      const { scope: cursorScope } = requirePartitionMessagePage(
        snapshot,
        PARTITION_MESSAGE_PAGE.suffix,
        [scope.turnScopeId],
        { cursor: null, limit: 1 },
      );
      await assert.rejects(read({ scope: cursorScope, after: 1 }), {
        code: "SESSION_STORAGE_CORRUPT",
        message:
          position === 1
            ? "Suffix anchor disagrees with session order"
            : "Session order references a message at the wrong position",
      });
      await assert.rejects(reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 }), {
        code: "SESSION_STORAGE_CORRUPT",
      });
    });
  });
}

test("turn pages and suffix anchors reject a different position in the same turn", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed-turn-order", {
      messages: [message(sessionId, "first"), message(sessionId, "second")],
    }),
  );
  const transactions = new PartitionTransactions(journal);
  const collection = PARTITION_MESSAGE_COLLECTIONS.order;
  const keys = [1, 2].map((ordinal) =>
    partitionMessageEntryKey(collection, scope.turnScopeId, ordinal),
  );
  await journal.usingSnapshot(async (snapshot) => {
    const entries = await transactions.lookupLatestMany({ snapshot, collection, keys });
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "swap-turn-positions",
      input: {},
      mutations: keys.map((key, index) => ({
        collection,
        key,
        owner: entries.get(key).owner,
        value: ["second", "first"][index],
      })),
      result: null,
    });
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  await reopened.usingSnapshot(async (snapshot) => {
    const failure = { code: "SESSION_STORAGE_CORRUPT" };
    const page = { snapshot, ...scope, cursor: null, limit: 1 };
    await assert.rejects(reader.readTurnPage(page), failure);
    await assert.rejects(reader.readMessageSuffixPage(page), failure);
  });
});

test("published removals hide messages without invalidating earlier snapshots", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  const created = await repository.commit(
    await prepare(journal, repository, "create-to-remove", {
      messages: [message(sessionId, "removed")],
    }),
  );
  const { owner, contentReference } = created.result.messageReceipts[0];
  const read = (reader, snapshot) =>
    reader.readContentPage({
      snapshot,
      ...scope,
      messageUid: "removed",
      contentReference,
      cursor: null,
      limit: 1,
    });
  const missing = { code: "SESSION_MESSAGE_NOT_FOUND", statusCode: 404 };
  await journal.usingSnapshot(async (snapshot) => {
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "remove-message-record",
      input: {},
      mutations: [{ collection: "messages", key: "removed", owner, remove: true }],
      result: null,
    });
    assert.deepEqual(await read(repository, snapshot), { entries: ["removed"], nextCursor: null });
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  await reopened.usingSnapshot((snapshot) => assert.rejects(read(reader, snapshot), missing));
  const append = await prepare(reopened, reader, "append-removed", {
    messageContentAppends: [
      {
        ...scope,
        messageUid: "removed",
        owner,
        expectedContentReference: contentReference,
        content: " tail",
      },
    ],
  });
  await assert.rejects(reader.commit(append), missing);
  assert.equal(reopened.head.sequence, created.generation + 1);
});

test("a hidden suffix UID stays hidden after its global position is reused", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { batchWaitMs: 20 });
  const repository = openTestMessages(journal, sessionId);
  const submit = (operationId, uid) =>
    prepare(journal, repository, operationId, { messages: [message(sessionId, uid)] });
  await repository.commit(await submit("seed-prefix", "prefix"));
  const oldScope = { dialogProcessId: "old-dialog", turnScopeId: "old-turn" };
  const created = await repository.commit(
    await prepare(journal, repository, "seed-before-truncate", {
      messages: [{ ...message(sessionId, "old"), ...oldScope }],
      timings: [{ ...oldScope, modelLoopRound: 1 }],
    }),
  );
  const [{ owner, contentReference }] = created.result.messageReceipts;
  const page = (reader, snapshot) =>
    reader.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 2 });
  const display = (reader, snapshot) =>
    reader.readDisplayPage({
      snapshot,
      selection: { cursor: null, direction: "forward", limit: 2, maxBytes: 4096 },
    });
  const content = (reader, snapshot) =>
    reader.readContentPage({
      snapshot,
      ...oldScope,
      messageUid: "old",
      contentReference,
      cursor: null,
      limit: 1,
    });
  const missing = { message: "Content message does not exist" };
  const { request, result } = await journal.usingSnapshot(async (snapshot) => {
    const truncate = await prepare(journal, repository, "truncate", {
      messageDeletion: { commandId: "truncate", anchor: { turnScopeId: oldScope.turnScopeId } },
    });
    const request = {
      ...(await submit("reuse-vacated-position", "new")),
      expectedGeneration: snapshot.sequence + 1,
    };
    const append = {
      ...(await prepare(journal, repository, "append-hidden-uid", {
        messageContentAppends: [
          {
            ...oldScope,
            messageUid: "old",
            owner,
            expectedContentReference: contentReference,
            content: "!",
          },
        ],
      })),
      expectedGeneration: snapshot.sequence + 2,
    };
    const publications = journal.work.publications;
    const [, result] = await Promise.all([
      repository.commit(truncate),
      repository.commit(request),
      assert.rejects(repository.commit(append), missing),
    ]);
    assert.equal(journal.work.publications, publications + 1);
    await assert.rejects(repository.commit(await submit("reuse-old-uid", "old")), {
      code: "SESSION_ENTITY_EXISTS",
    });
    assert.equal(journal.head.sequence, result.generation);
    assert.deepEqual((await page(repository, snapshot)).entries, ["prefix", "old"]);
    const retainedDisplay = await display(repository, snapshot);
    assert.deepEqual(
      retainedDisplay.messages.map(({ messageUid }) => messageUid),
      ["prefix", "old"],
    );
    assert.equal(retainedDisplay.stats.displayMessageCount, 2);
    assert.deepEqual((await content(repository, snapshot)).entries, ["old"]);
    assert.equal(
      (await repository.readTurnTiming({ snapshot, turnScopeId: oldScope.turnScopeId }))
        .modelLoopRound,
      1,
    );
    return { request, result };
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...result, replayed: true });
  assert.equal(reopened.head.sequence, result.generation);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.deepEqual((await page(reader, snapshot)).entries, ["prefix", "new"]);
    const currentDisplay = await display(reader, snapshot);
    assert.deepEqual(
      currentDisplay.messages.map(({ messageUid }) => messageUid),
      ["prefix", "new"],
    );
    assert.equal(currentDisplay.stats.displayMessageCount, 2);
    await assert.rejects(content(reader, snapshot), missing);
    assert.equal(
      await reader.readTurnTiming({ snapshot, turnScopeId: oldScope.turnScopeId }),
      null,
    );
    assert.equal(
      await reader.readMessageSuffixPage({ snapshot, ...oldScope, cursor: null, limit: 1 }),
      null,
    );
    assert.deepEqual(await reader.readTurnPage({ snapshot, ...oldScope, cursor: null, limit: 1 }), {
      entries: [],
      nextCursor: null,
    });
    const turn = await reader.readTurnPage({ snapshot, ...scope, cursor: null, limit: 2 });
    assert.deepEqual(
      turn.entries.map(({ message }) => message.messageUid),
      ["prefix", "new"],
    );
  });
});

test("turn reads and appends share the retained prefix after an interleaved truncation", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { pageRecords: 2 });
  const repository = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  const submit = async (operationId, messages) =>
    repository.commit(await prepare(journal, repository, operationId, { messages }));
  await submit("seed-interleaved", [
    message(sessionId, "retained"),
    { ...message(sessionId, "anchor"), ...other },
  ]);
  await submit("seed-discarded", [
    message(sessionId, "discarded"),
    message(sessionId, "discarded-tail"),
  ]);
  const turnPage = (snapshot, ownership = scope, limit = 1) =>
    repository.readTurnPage({ snapshot, ...ownership, cursor: null, limit });
  await journal.usingSnapshot(async (snapshot) => {
    const changes = {
      messageDeletion: { commandId: "delete-suffix", anchor: { turnScopeId: other.turnScopeId } },
    };
    const request = await prepare(journal, repository, "delete-suffix", changes);
    const committed = await repository.commit(request);
    assert.deepEqual(committed.result.messageDeletion.receipt.result, {
      anchorIndex: 1,
      deletedCount: 3,
      deletedTurnScopeIds: [other.turnScopeId, scope.turnScopeId],
    });
    assert.deepEqual(await repository.commit(request), { ...committed, replayed: true });
    const duplicate = await repository.commit(
      await prepare(journal, repository, "repeat-delete-suffix", changes),
    );
    assert.deepEqual(duplicate.result.messageDeletion, {
      receipt: committed.result.messageDeletion.receipt,
      deduplicated: true,
    });
    await journal.usingSnapshot(async (truncated) => {
      assert.equal((await turnPage(truncated)).nextCursor, null);
      assert.deepEqual((await turnPage(truncated, other)).entries, []);
      assert.equal(
        await repository.readMessageSuffixPage({
          snapshot: truncated,
          ...other,
          cursor: null,
          limit: 1,
        }),
        null,
      );
    });
    await submit("append-after-truncation", [message(sessionId, "new")]);
    const uids = ({ entries }) => entries.map(({ message }) => message.messageUid);
    const retainedPage = await turnPage(snapshot, scope, 2);
    assert.deepEqual(uids(retainedPage), ["retained", "discarded"]);
    assert.ok(retainedPage.nextCursor);
    assert.deepEqual(
      uids(
        await repository.readTurnPage({
          snapshot,
          ...scope,
          cursor: retainedPage.nextCursor,
          limit: 2,
        }),
      ),
      ["discarded-tail"],
    );
    await journal.usingSnapshot(async (latest) => {
      assert.deepEqual(uids(await turnPage(latest, scope, 2)), ["retained", "new"]);
      assert.deepEqual((await turnPage(latest, other)).entries, []);
    });
  });
});

test("a corrupt earlier suffix page leaves the entire deletion unpublished", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(
    t,
    { pageRecords: 2 },
    { autoClose: false },
  );
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  for (const uids of [
    ["anchor", "second"],
    ["third", "fourth"],
  ]) {
    await repository.commit(
      await prepare(journal, repository, `seed-${uids[0]}`, {
        messages: uids.map((uid) => message(sessionId, uid)),
      }),
    );
  }
  const collection = PARTITION_MESSAGE_COLLECTIONS.sessionOrder;
  const key = partitionMessageEntryKey(collection, sessionId, 2);
  await journal.usingSnapshot(async (snapshot) => {
    const entries = await transactions.lookupLatestMany({ snapshot, collection, keys: [key] });
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "corrupt-earlier-suffix-position",
      input: {},
      mutations: [{ collection, key, owner: entries.get(key).owner, value: "anchor" }],
      result: null,
    });
  });
  const request = await prepare(journal, repository, "delete-corrupt-suffix", {
    messageDeletion: {
      commandId: "delete-corrupt-suffix",
      anchor: { turnScopeId: scope.turnScopeId },
    },
  });
  await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = openTestMessages(reopened, sessionId);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.sequence, request.expectedGeneration);
    const page = { snapshot, ...scope, cursor: null, limit: 1 };
    assert.equal((await reader.readTurnPage(page)).entries[0].message.messageUid, "anchor");
    const commands = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection: "commands",
      keys: ["delete-corrupt-suffix"],
    });
    assert.equal(commands.get("delete-corrupt-suffix"), null);
  });
});

test("a turn page does not probe positions beyond its next cursor", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const transactions = new PartitionTransactions(journal);
  for (const uids of [
    ["first", "second"],
    ["third", "last"],
  ]) {
    await repository.commit(
      await prepare(journal, repository, `seed-${uids[0]}`, {
        messages: uids.map((uid) => message(sessionId, uid)),
      }),
    );
  }
  const collection = PARTITION_MESSAGE_COLLECTIONS.order;
  const key = partitionMessageEntryKey(collection, scope.turnScopeId, 4);
  await journal.usingSnapshot(async (snapshot) => {
    const entries = await transactions.lookupLatestMany({ snapshot, collection, keys: [key] });
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "corrupt-distant-position",
      input: {},
      mutations: [{ collection, key, owner: entries.get(key).owner, value: "first" }],
      result: null,
    });
  });
  await journal.usingSnapshot(async (snapshot) => {
    const read = (cursor) => repository.readTurnPage({ snapshot, ...scope, cursor, limit: 1 });
    const first = await read(null);
    assert.deepEqual(
      first.entries.map(({ message }) => message.messageUid),
      ["first"],
    );
    assert.ok(first.nextCursor);
    const second = await read(first.nextCursor);
    assert.deepEqual(
      second.entries.map(({ message }) => message.messageUid),
      ["second"],
    );
    assert.ok(second.nextCursor);
    const third = await read(second.nextCursor);
    assert.deepEqual(
      third.entries.map(({ message }) => message.messageUid),
      ["third"],
    );
    assert.ok(third.nextCursor);
    await assert.rejects(read(third.nextCursor), { code: "SESSION_STORAGE_CORRUPT" });
  });
});

test("turn pages preserve creation order when messages live in different partitions", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { partitionRecords: 3 });
  const repository = openTestMessages(journal, sessionId);
  const create = (uid) =>
    prepare(journal, repository, uid, { messages: [message(sessionId, uid)] });
  const first = await repository.commit(await create("m3"));
  const second = await repository.commit(await create("m1"));
  assert.equal(second.reference.partition, first.reference.partition);
  const third = await create("m2");
  const publications = journal.work.publications;
  const last = await repository.commit(third);
  assert.equal(journal.work.publications, publications + 2);
  assert.ok(last.reference.partition > first.reference.partition);
  await journal.usingSnapshot(async (snapshot) => {
    const read = (cursor) => repository.readTurnPage({ snapshot, ...scope, cursor, limit: 2 });
    const page = await read(null);
    assert.deepEqual(
      page.entries.map(({ message }) => message.messageUid),
      ["m3", "m1"],
    );
    const tail = await read(page.nextCursor);
    assert.deepEqual(
      tail.entries.map(({ message }) => message.messageUid),
      ["m2"],
    );
    assert.equal(tail.nextCursor, null);
  });
});
