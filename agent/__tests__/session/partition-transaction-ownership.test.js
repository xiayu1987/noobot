/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  decodePartitionJournalDirectory,
  encodePartitionJournalDirectory,
} from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  directoryPageRead,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { entityDirectoryPath } from "../../src/session/partition-storage/entity-directory-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { request, createAt } from "./partition-transactions.test-helpers.js";

test("entity reads reject wrong ownership, slots, future snapshots and conflicting retry", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  const oldSnapshot = await journal.snapshot();
  const input = request(journal, 1);
  const first = await commitFixtureTransaction(transactions, input);
  const entity = first.mutations[0];
  const snapshot = await journal.snapshot();
  await assert.rejects(transactions.readEntity({ snapshot, ...entity, key: "wrong" }), {
    code: "SESSION_STORAGE_IDENTITY",
  });
  await assert.rejects(
    transactions.readEntity({ snapshot, ...entity, reference: { ...entity.reference, slot: 1 } }),
    { code: "SESSION_STORAGE_IDENTITY" },
  );
  await assert.rejects(
    transactions.readEntity({ snapshot, ...entity, owner: { ...entity.owner, slot: 1 } }),
    { code: "SESSION_STORAGE_IDENTITY" },
  );
  await assert.rejects(
    transactions.readEntity({ snapshot, ...entity, owner: undefined }),
    TypeError,
  );
  await assert.rejects(transactions.readEntity({ snapshot: oldSnapshot, ...entity }), RangeError);
  await assert.rejects(commitFixtureTransaction(transactions, { ...input, input: null }), {
    code: "SESSION_OPERATION_CONFLICT",
  });
});

test("an initial tombstone owns its identity across cold replay and rejects null-owner recreation", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const initial = request(journal, 1, [
    { collection: "lifecycle", key: "retired", owner: null, remove: true },
  ]);
  const committed = await commitFixtureTransaction(writer, initial);
  const owner = committed.mutations[0].owner;
  assert.deepEqual(owner, { ...committed.reference, slot: 0 });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  assert.equal((await commitFixtureTransaction(reader, initial)).replayed, true);
  const before = cold.head.sequence;
  await assert.rejects(
    commitFixtureTransaction(
      reader,
      request(cold, 2, [
        { collection: "lifecycle", key: "retired", owner: null, value: "must-not-publish" },
      ]),
    ),
    { code: "SESSION_ENTITY_EXISTS" },
  );
  assert.equal(cold.head.sequence, before);
  const stored = await reader.readEntity({
    snapshot: await cold.snapshot(),
    ...committed.mutations[0],
  });
  assert.equal(stored.remove, true);
});

test("bounded receipts expire but old entity versions remain directly readable", async (t) => {
  const { journal } = await createTransactionCase(t, { receiptRecords: 2, partitionRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  const input = request(journal, 1);
  const first = await commitFixtureTransaction(transactions, input);
  await commitFixtureTransaction(
    transactions,
    request(journal, 2, [
      { collection: "messages", key: "m", owner: first.mutations[0].owner, remove: true },
    ]),
  );
  await transactions.projectLatestUpdates();
  await commitFixtureTransaction(
    transactions,
    request(journal, 3, [{ collection: "messages", key: "another", owner: null, value: "x" }]),
  );
  await assert.rejects(commitFixtureTransaction(transactions, input), {
    code: "SESSION_REQUEST_EXPIRED",
  });
  const { epoch, expectedGeneration, operationId, input: original } = input;
  await assert.rejects(
    transactions.commit(
      { epoch, expectedGeneration, operationId, input: original },
      {
        validateScope: () => {},
        prepare: () => assert.fail("Expired requests must not prepare"),
      },
    ),
    { code: "SESSION_REQUEST_EXPIRED" },
  );
  const snapshot = await journal.snapshot();
  const mutation = await transactions.readEntity({ snapshot, ...first.mutations[0] });
  assert.equal(mutation.value, "x");
});

test("updates across partitions preserve the creation owner after reopen", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  await commitFixtureTransaction(writer, createAt(journal, 1));
  const first = await commitFixtureTransaction(writer, request(journal, 2));
  assert.equal(first.reference.partition, 1);
  const owner = first.mutations[0].owner;
  assert.deepEqual(owner, { ...first.reference, slot: 0 });
  const update = await commitFixtureTransaction(
    writer,
    request(journal, 3, [{ collection: "messages", key: "m", owner, value: "updated" }]),
  );
  assert.deepEqual(update.mutations[0].owner, owner);
  assert.notEqual(update.reference.partition, first.reference.partition);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reader.projectLatestUpdates();
  const removed = await commitFixtureTransaction(
    reader,
    request(reopened, 4, [{ collection: "messages", key: "m", owner, remove: true }]),
  );
  assert.deepEqual(removed.mutations[0].owner, owner);
  assert.equal(
    (await reader.readEntity({ snapshot: await reopened.snapshot(), ...removed.mutations[0] }))
      .remove,
    true,
  );
});

test("well-formed but wrong creation owners never publish and leave the writer usable", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const owner = first.mutations[0].owner;
  await commitFixtureTransaction(
    writer,
    request(journal, 2, [{ collection: "messages", key: "m", owner, value: "updated" }]),
  );
  await writer.projectLatestUpdates();
  const mutations = [
    { collection: "messages", key: "other", owner, value: "wrong-key" },
    { collection: "outbox", key: "m", owner, value: "wrong-collection" },
    { collection: "messages", key: "m", owner: { ...owner, slot: 9 }, value: "bad-slot" },
    { collection: "messages", key: "m", owner: { ...owner, partition: 1 }, value: "bad-partition" },
    {
      collection: "messages",
      key: "m",
      owner: { ...owner, sequence: 2 },
      value: "wrong-creation-sequence",
    },
    {
      collection: "messages",
      key: "m",
      owner: { ...owner, epoch: "f".repeat(32) },
      value: "wrong-epoch",
    },
  ];
  const writes = journal.work.writeBytes + journal.work.controlWriteBytes;
  for (const mutation of mutations)
    await assert.rejects(commitFixtureTransaction(writer, request(journal, 3, [mutation])));
  assert.equal(journal.work.writeBytes + journal.work.controlWriteBytes, writes);
  assert.equal(journal.failure, null);
  await commitFixtureTransaction(
    writer,
    request(journal, 3, [{ collection: "messages", key: "m", owner, remove: true }]),
  );
});

test("an unresolved owner rejects the entire active directory merge", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 8 });
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const { owner } = first.mutations[0];
  const update = { collection: "messages", key: "m", owner, value: "updated" };
  const creation = { collection: "messages", key: "new", owner: null, value: "created" };
  const directory = structuredClone(journal.head.entityDirectory);
  const writes = journal.work.writeBytes + journal.work.controlWriteBytes;
  await assert.rejects(
    commitFixtureTransaction(
      writer,
      request(journal, 2, [update, creation, { ...update, key: "unregistered" }]),
    ),
    { code: "SESSION_STORAGE_IDENTITY" },
  );
  assert.equal(journal.head.sequence, 1);
  assert.deepEqual(journal.head.entityDirectory, directory);
  assert.equal(journal.work.writeBytes + journal.work.controlWriteBytes, writes);

  const committed = await commitFixtureTransaction(writer, request(journal, 2, [update, creation]));
  assert.equal(committed.reference.partition, first.reference.partition);
  assert.deepEqual(committed.mutations[0].owner, owner);
});

test("a group validates an owner created earlier in the same unpublished batch", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const owner = { epoch: journal.head.epoch, partition: 0, sequence: 1, slot: 0 };
  const outcomes = await Promise.all([
    commitFixtureTransaction(writer, request(journal, 1)),
    commitFixtureTransaction(writer, createAt(journal, 2)),
    commitFixtureTransaction(
      writer,
      request(journal, 3, [{ collection: "messages", key: "m", owner, value: "next" }]),
    ),
  ]);
  assert.deepEqual(
    outcomes.map(({ reference }) => reference.partition),
    [0, 1, 2],
  );
  assert.deepEqual(outcomes[2].mutations[0].owner, outcomes[0].mutations[0].owner);
  assert.equal(journal.work.publications, 2);
});

test("entity creation remains unique across a batch, partitions and reopen", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const [created, duplicate, advanced] = await Promise.allSettled([
    commitFixtureTransaction(writer, request(journal, 1)),
    commitFixtureTransaction(writer, request(journal, 2)),
    commitFixtureTransaction(writer, createAt(journal, 2)),
  ]);
  assert.equal(created.status, "fulfilled");
  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.reason.code, "SESSION_ENTITY_EXISTS");
  assert.equal(advanced.status, "fulfilled");
  assert.equal(journal.head.tail.partition, 1);
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await assert.rejects(commitFixtureTransaction(reader, request(reopened, 3)), {
    code: "SESSION_ENTITY_EXISTS",
  });
  assert.equal(reopened.head.sequence, 2);
  await reopened.usingSnapshot(async (snapshot) => {
    const latest = await reader.lookupLatestMany({ snapshot, collection: "messages", keys: ["m"] });
    assert.deepEqual(latest.get("m").owner, created.value.mutations[0].owner);
  });
});

test("rollover backpressure schedules maintenance before the next queued batch", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(writer, request(journal, 1));
  const { owner } = created.mutations[0];
  const updated = await commitFixtureTransaction(
    writer,
    request(journal, 2, [{ collection: "messages", key: "m", owner, value: "updated" }]),
  );
  await journal.usingSnapshot(async (snapshot) => {
    const publications = journal.work.publications;
    await assert.rejects(commitFixtureTransaction(writer, request(journal, 3)), {
      code: "SESSION_ENTITY_EXISTS",
    });
    assert.equal(journal.work.publications, publications);
    const rollover = request(journal, 3, [
      { collection: "messages", key: "n", owner: null, value: "new" },
    ]);
    const following = request(journal, 4, [
      { collection: "messages", key: "p", owner: null, value: "later" },
    ]);
    const outcomes = await Promise.all([
      commitFixtureTransaction(writer, rollover),
      commitFixtureTransaction(writer, following),
    ]);
    assert.deepEqual(
      outcomes.map(({ generation }) => generation),
      [3, 4],
    );
    assert.equal(journal.work.publications, publications + 2);
    assert.equal(journal.head.tail.partition, snapshot.tail.partition + 1);
    const query = { collection: "messages", keys: ["m", "n"] };
    const previous = await writer.lookupLatestMany({ ...query, snapshot });
    assert.deepEqual(previous.get("m").reference, updated.mutations[0].reference);
    assert.equal(previous.get("n"), null);
    await journal.usingSnapshot(async (latest) => {
      const entries = await writer.lookupLatestMany({ ...query, snapshot: latest });
      assert.deepEqual(entries.get("m"), previous.get("m"));
      assert.equal(entries.get("n").reference.record.sequence, 3);
    });
  });
});

test("a warm writer checks key claims published by a different writer", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const first = new PartitionTransactions(journal);
  await commitFixtureTransaction(first, request(journal, 1));

  const secondJournal = await PartitionJournal.open({ root, sessionId });
  t.after(() => secondJournal.close());
  const second = new PartitionTransactions(secondJournal);
  const claimed = [{ collection: "messages", key: "claimed", owner: null, value: "second" }];
  const {
    mutations: [created],
  } = await commitFixtureTransaction(second, request(secondJournal, 2, claimed));

  await assert.rejects(commitFixtureTransaction(first, request(journal, 3, claimed)), {
    code: "SESSION_ENTITY_EXISTS",
  });
  const updated = [{ ...claimed[0], owner: created.owner, value: "first" }];
  await commitFixtureTransaction(first, request(journal, 3, updated));
  await journal.usingSnapshot(async (snapshot) => {
    const values = await first.getLatestMany({
      snapshot,
      collection: "messages",
      keys: ["claimed"],
    });
    assert.equal(values.get("claimed").value, "first");
  });
});

test("a group can update a committed owner beyond the receipt window", async (t) => {
  const { journal } = await createTransactionCase(t, { receiptRecords: 2, partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const owner = first.mutations[0].owner;
  for (const sequence of [2, 3, 4])
    await commitFixtureTransaction(writer, createAt(journal, sequence));
  await assert.rejects(commitFixtureTransaction(writer, request(journal, 1)), {
    code: "SESSION_REQUEST_EXPIRED",
  });
  const updates = await Promise.all(
    Array.from({ length: 2 }, (_, index) =>
      commitFixtureTransaction(
        writer,
        request(journal, index + 5, [{ collection: "messages", key: "m", owner, value: index }]),
      ),
    ),
  );
  assert.equal(updates.length, 2);
  const last = updates.at(-1);
  assert.deepEqual(last.mutations[0].owner, owner);
  assert.equal(
    (await writer.readEntity({ snapshot: await journal.snapshot(), ...last.mutations[0] })).value,
    1,
  );
});

test("a forged staged epoch is rejected without poisoning later requests in the group", async (t) => {
  const { journal } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const owner = { epoch: journal.head.epoch, partition: 0, sequence: 1, slot: 0 };
  const wrong = { ...owner, epoch: "f".repeat(32) };
  const outcomes = await Promise.allSettled([
    commitFixtureTransaction(writer, request(journal, 1)),
    commitFixtureTransaction(
      writer,
      request(journal, 2, [{ collection: "messages", key: "m", owner: wrong, value: "bad" }]),
    ),
    commitFixtureTransaction(
      writer,
      request(journal, 2, [{ collection: "messages", key: "m", owner, value: "good" }]),
    ),
  ]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(outcomes[1].reason.code, "SESSION_STORAGE_IDENTITY");
  assert.equal(outcomes[2].status, "fulfilled");
  assert.equal((await journal.snapshot()).sequence, 2);
  assert.equal(journal.failure, null);
});

test("reopened entity updates use registered ownership after receipt expiry and projection", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 1,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const owner = first.mutations[0].owner;
  await commitFixtureTransaction(
    writer,
    request(journal, 2, [{ collection: "messages", key: "m", owner, value: "second" }]),
  );
  await writer.projectLatestUpdates();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.ok(reopened.head.receiptStart.sequence >= first.reference.sequence);
  assert.equal(reopened.head.deferredEntityUpdates, null);
  const transactions = new PartitionTransactions(reopened);
  const adapter = getFsAdapter();
  const creationFile = journalPartitionPath(root, first.reference.partition);
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      assert.notEqual(String(file), creationFile, "update must not reopen the creation body");
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    const registered = await reopened.usingSnapshot(async (snapshot) => {
      const entries = await transactions.lookupLatestMany({
        snapshot,
        collection: "messages",
        keys: ["m", "missing"],
      });
      assert.equal(entries.get("missing"), null);
      return entries.get("m");
    });
    assert.deepEqual(registered.owner, owner);
    assert.equal(registered.reference.record.sequence, 2);
    assert.notEqual(registered.reference.record.partition, first.reference.partition);
    const updated = await commitFixtureTransaction(
      transactions,
      request(reopened, 3, [
        { collection: "messages", key: "m", owner: registered.owner, value: "third" },
      ]),
    );
    assert.deepEqual(updated.mutations[0].owner, owner);
    await reopened.usingSnapshot(async (snapshot) => {
      const latest = await transactions.getLatestMany({
        snapshot,
        collection: "messages",
        keys: ["m"],
      });
      assert.equal(latest.get("m").value, "third");
    });
  } finally {
    setFsAdapter(adapter);
  }
});

test("a sealed owner root pointing at another partition aborts the whole unpublished batch", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(writer, request(journal, 1));
  const { owner } = created.mutations[0];
  const update = (sequence) =>
    request(journal, sequence, [{ collection: "messages", key: "m", owner, value: sequence }]);
  await commitFixtureTransaction(writer, update(2));
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, createAt(journal, 3));
  await journal.close();

  const start = journalDirectoryPath(root, 0);
  const original = await readFile(start, "utf8");
  const foreign = decodePartitionJournalDirectory(
    await readFile(journalDirectoryPath(root, 1), "utf8"),
  );
  const entry = decodePartitionJournalDirectory(original);
  await writeFile(
    start,
    encodePartitionJournalDirectory({ ...entry, collectionRoot: foreign.collectionRoot }),
  );

  const cold = await PartitionJournal.open({ root, sessionId });
  const transactions = new PartitionTransactions(cold);
  await cold.usingSnapshot(async (snapshot) => {
    await assert.rejects(
      transactions.lookupMany({ snapshot, partition: 0, collection: "messages", keys: ["m"] }),
      {
        code: "SESSION_STORAGE_CORRUPT",
      },
    );
  });
  const earlier = createAt(cold, 4);
  const before = await readFile(`${root}/CURRENT`);
  const outcomes = await Promise.allSettled([
    commitFixtureTransaction(transactions, earlier),
    commitFixtureTransaction(transactions, update(5)),
  ]);
  assert.deepEqual(
    outcomes.map((outcome) => [outcome.status, outcome.reason?.code]),
    [
      ["rejected", "SESSION_STORAGE_CORRUPT"],
      ["rejected", "SESSION_STORAGE_CORRUPT"],
    ],
  );
  assert.deepEqual(await readFile(`${root}/CURRENT`), before);
  await assert.rejects(cold.close(), { code: "SESSION_STORAGE_CORRUPT" });

  await writeFile(start, original);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const retried = new PartitionTransactions(reopened);
  const results = await Promise.all([
    commitFixtureTransaction(retried, earlier),
    commitFixtureTransaction(retried, update(5)),
  ]);
  assert.deepEqual(
    results.map(({ generation }) => generation),
    [4, 5],
  );
});

test("published ownership directory failures abort a whole batch before publication", async (t) => {
  const faults = {
    codec: async (file, offset) => {
      const handle = await open(file, "r+");
      try {
        await handle.write(Buffer.from([255]), 0, 1, offset);
      } finally {
        await handle.close();
      }
    },
  };
  for (const [kind, damage] of Object.entries(faults)) {
    await t.test(kind, async (t) => {
      const { journal, root, sessionId } = await createTransactionCase(
        t,
        { partitionRecords: 1, receiptRecords: 2 },
        { autoClose: false },
      );
      const writer = new PartitionTransactions(journal);
      const created = await commitFixtureTransaction(writer, request(journal, 1));
      await commitFixtureTransaction(writer, createAt(journal, 2));
      await commitFixtureTransaction(writer, createAt(journal, 3));
      assert.equal(journal.head.receiptStart.sequence, 1);
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      const position = cold.head.entityDirectory.identities.position;
      const directory = entityDirectoryPath(root, position.segment);
      const original = await readFile(directory);
      await damage(directory, position.offset);
      const coldWriter = new PartitionTransactions(cold);

      const earlier = createAt(journal, 4);
      const update = request(journal, 5, [
        { collection: "messages", key: "m", owner: created.mutations[0].owner, value: "next" },
      ]);
      const adapter = getFsAdapter();
      setFsAdapter({
        ...adapter,
        async open(file, ...args) {
          assert.notEqual(String(file), journalPartitionPath(root, created.reference.partition));
          return adapter.open(file, ...args);
        },
      });
      try {
        await Promise.all([
          assert.rejects(commitFixtureTransaction(coldWriter, earlier), {
            code: "SESSION_STORAGE_CORRUPT",
          }),
          assert.rejects(commitFixtureTransaction(coldWriter, update), {
            code: "SESSION_STORAGE_CORRUPT",
          }),
        ]);
      } finally {
        setFsAdapter(adapter);
      }

      await assert.rejects(cold.close(), { code: "SESSION_STORAGE_CORRUPT" });
      await writeFile(directory, original);
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      assert.equal(reopened.head.sequence, 3);
      const retried = new PartitionTransactions(reopened);
      await Promise.all([
        commitFixtureTransaction(retried, earlier),
        commitFixtureTransaction(retried, update),
      ]);
      await reopened.usingSnapshot(async (snapshot) => {
        const latest = await retried.getLatestMany({
          snapshot,
          collection: "messages",
          keys: ["m"],
        });
        assert.equal(latest.get("m").value, "next");
      });
    });
  }
});

test("cold non-sealing updates do not synchronously traverse the session directory", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 2,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const batchSize = 10;
  const keys = Array.from({ length: 80 }, (_, index) =>
    createHash("sha256").update(String(index)).digest("hex"),
  );
  const first = await commitFixtureTransaction(
    writer,
    request(
      journal,
      1,
      keys.slice(0, batchSize).map((key) => ({
        collection: "messages",
        key,
        owner: null,
        value: 1,
      })),
    ),
  );
  const creationRecords = keys.length / batchSize;
  for (let sequence = 2; sequence <= creationRecords; sequence += 1)
    await commitFixtureTransaction(
      writer,
      request(
        journal,
        sequence,
        keys.slice((sequence - 1) * batchSize, sequence * batchSize).map((key) => ({
          collection: "messages",
          key,
          owner: null,
          value: sequence,
        })),
      ),
    );
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = new PartitionTransactions(reopened);
  const { key, owner } = first.mutations[0];
  await reopened.usingSnapshot(async (old) => {
    const mutation = (value) => [{ collection: "messages", key, owner, value }];
    const advanced = await commitFixtureTransaction(
      writer,
      request(journal, creationRecords + 1, mutation("other writer")),
    );
    const { identities, latestUpdates, activeCollection } = journal.head.entityDirectory;
    assert.equal(activeCollection.level, 0);
    const creationFile = journalPartitionPath(root, first.reference.partition);
    let creationReads = 0;
    const { result: updated, reads } = await observeDirectoryPageReads(
      () =>
        commitFixtureTransaction(
          cold,
          request(reopened, creationRecords + 2, mutation("cold writer")),
        ),
      (file) => {
        if (String(file) === creationFile) creationReads += 1;
      },
    );
    assert.equal(updated.reference.partition, advanced.reference.partition, "must not seal");
    assert.equal(creationReads, 0, "must not reopen the creation body");
    assert.deepEqual(reads, [directoryPageRead(root, activeCollection.position)]);
    assert.deepEqual(reopened.head.entityDirectory.identities, identities);
    assert.deepEqual(reopened.head.entityDirectory.latestUpdates, latestUpdates);
    assert.notDeepEqual(reopened.head.entityDirectory.activeCollection, activeCollection);
    const read = (snapshot) =>
      cold.getLatestMany({ snapshot, collection: "messages", keys: [key] });
    assert.equal((await read(old)).get(key).value, 1);
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal((await read(snapshot)).get(key).value, "cold writer");
    });
  });
});

test("a rolling cold update of a sealed owner reads only its creation root", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 1,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(writer, request(journal, 1));
  const creationRoot = journal.head.entityDirectory.activeCollection;
  const second = await commitFixtureTransaction(writer, createAt(journal, 2));
  assert.equal(second.reference.partition, first.reference.partition + 1);
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  const { identities } = cold.head.entityDirectory;
  const { key, owner } = first.mutations[0];
  const update = request(cold, 3, [{ collection: "messages", key, owner, value: "updated" }]);
  const { result, reads } = await observeDirectoryPageReads(() =>
    commitFixtureTransaction(reader, update),
  );
  assert.equal(result.reference.partition, second.reference.partition + 1);
  assert.deepEqual(reads, [directoryPageRead(root, creationRoot.position)]);
  assert.deepEqual(cold.head.entityDirectory.identities, identities);
  assert.equal(cold.head.entityDirectory.latestUpdates, null);
  const replay = await commitFixtureTransaction(reader, update);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.reference, result.reference);
});

test("owner reads resolve sealed creations and updates without consulting the global identity directory", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 2,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const {
    mutations: [created],
  } = await commitFixtureTransaction(writer, request(journal, 1));
  const { key, owner } = created;
  const collection = "messages";
  const entities = [{ key, owner }];
  await commitFixtureTransaction(writer, createAt(journal, 2));
  const creationPartitionRoot = journal.head.entityDirectory.activeCollection;
  await commitFixtureTransaction(writer, createAt(journal, 3));
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  await cold.usingSnapshot(async (old) => {
    assert.ok(old.tail.partition > owner.partition);
    const { result, reads } = await observeDirectoryPageReads(() =>
      reader.getLatestByOwner({ snapshot: old, collection, entities }),
    );
    assert.equal(result.get(key).value, "x");
    assert.deepEqual(reads, [
      directoryPageRead(root, old.entityDirectory.activeCollection.position),
      directoryPageRead(root, creationPartitionRoot.position),
    ]);
    await assert.rejects(
      reader.getLatestByOwner({ snapshot: old, collection, entities: [{ key: "m2", owner }] }),
      { code: "SESSION_STORAGE_IDENTITY" },
    );

    const { epoch, expectedGeneration, input, operationId } = request(cold, 4);
    const creationDirectory = journalDirectoryPath(root, owner.partition);
    const directoryOpens = [];
    const { result: updated } = await observeDirectoryPageReads(
      () =>
        reader.commit(
          { epoch, expectedGeneration, input, operationId },
          {
            validateScope: () => {},
            prepare: async (_snapshot, view) => {
              const loaded = (await view.getLatestByOwner({ collection, entities })).get(key);
              return {
                action: "commit",
                mutations: [
                  { collection, key, owner: loaded.owner, value: `${loaded.mutation.value}!` },
                ],
                result: null,
              };
            },
          },
        ),
      (file, flags) => {
        if (String(file) === creationDirectory && flags === "r") directoryOpens.push(file);
      },
    );
    assert.deepEqual(directoryOpens.map(String), [creationDirectory]);
    await reader.projectLatestUpdates();
    const rolled = await commitFixtureTransaction(reader, createAt(cold, 5));
    assert.equal(rolled.reference.partition, updated.reference.partition + 1);
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const latest = new PartitionTransactions(reopened);
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal(snapshot.tail.partition, rolled.reference.partition);
      assert.notEqual(snapshot.entityDirectory.latestUpdates, null);
      const { result, reads } = await observeDirectoryPageReads(() =>
        latest.getLatestByOwner({ snapshot, collection, entities }),
      );
      assert.equal(result.get(key).value, "x!");
      assert.deepEqual(reads, [
        directoryPageRead(root, snapshot.entityDirectory.activeCollection.position),
        directoryPageRead(root, snapshot.entityDirectory.latestUpdates.position),
      ]);
    });
    assert.equal(
      (await reader.getLatestByOwner({ snapshot: old, collection, entities })).get(key).value,
      "x",
    );
  });
});
