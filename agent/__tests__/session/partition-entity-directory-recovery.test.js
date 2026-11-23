/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, rename, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  decodePartitionEntityPageDelta,
  PARTITION_ENTITY_PAGE_CODEC,
} from "@noobot/session-protocol/partition-entity-directory";
import {
  partitionJournalReservedBytes,
  partitionJournalReservedInodes,
} from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  EntityDirectoryAppend,
  entityDirectoryPath,
  readEntityDirectoryNode,
} from "../../src/session/partition-storage/entity-directory-io.js";
import { publishJournalHead } from "../../src/session/partition-storage/journal-io.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  directoryPageRead,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";

test("reopen rejects a missing committed entity directory without changing CURRENT", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const transaction = {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "create-message",
    input: null,
    mutations: [{ collection: "messages", key: "m", owner: null, value: 1 }],
    result: null,
  };
  await commitFixtureTransaction(new PartitionTransactions(journal), transaction);
  const { segment, offset } = journal.head.entityDirectory;
  assert.ok(offset > 0);
  await journal.close();

  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const file = entityDirectoryPath(root, segment);
  const displaced = `${file}.displaced`;
  await rename(file, displaced);
  try {
    await assert.rejects(PartitionJournal.open({ root, sessionId }), (error) => {
      assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
      assert.equal(error.cause?.code, "ENOENT");
      assert.equal(error.cause.path, file);
      return true;
    });
    await assert.rejects(stat(file), { code: "ENOENT" });
    assert.deepEqual(await readFile(current), before);
  } finally {
    await rename(displaced, file);
  }

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    const records = await reader.getLatestMany({ snapshot, collection: "messages", keys: ["m"] });
    assert.equal(records.get("m").value, 1);
  });
  assert.deepEqual(await readFile(current), before);
});

for (const receiptRecords of [1, 8]) {
  test(`cold lookup uses only the published locator before update admission (receiptRecords=${receiptRecords})`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { receiptRecords });
    const writer = new PartitionTransactions(journal);
    const update = (sequence, owner) => ({
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
      result: null,
    });
    const created = await commitFixtureTransaction(writer, update(1, null));
    const { owner } = created.mutations[0];
    await commitFixtureTransaction(writer, update(2, owner));
    await writer.projectLatestUpdates();
    await commitFixtureTransaction(writer, update(3, owner));
    await commitFixtureTransaction(writer, update(4, owner));
    await journal.close();

    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    assert.notEqual(cold.head.entityDirectory.latestUpdates, null);
    assert.notEqual(cold.head.deferredEntityUpdates, null);
    const transactions = new PartitionTransactions(cold);
    const bodyReads = [];
    const observeBodyOpen = (file, flags) => {
      if (flags === "r" && String(file).endsWith("records.log")) bodyReads.push(file);
    };
    const { result: lookup, reads: lookupReads } = await observeDirectoryPageReads(
      () =>
        cold.usingSnapshot((snapshot) =>
          transactions.lookupLatestMany({ snapshot, collection: "messages", keys: ["m"] }),
        ),
      observeBodyOpen,
    );
    assert.equal(lookup.get("m").reference.record.sequence, 4);
    assert.deepEqual(lookupReads, [
      directoryPageRead(root, cold.head.entityDirectory.activeCollection.position),
    ]);
    assert.deepEqual(bodyReads, []);
    const fresh = await PartitionJournal.open({ root, sessionId });
    t.after(() => fresh.close());
    const freshWriter = new PartitionTransactions(fresh);
    const { identities, latestUpdates, activeCollection } = fresh.head.entityDirectory;
    assert.equal(activeCollection.level, 0);
    const { reads } = await observeDirectoryPageReads(
      () => commitFixtureTransaction(freshWriter, update(5, owner)),
      observeBodyOpen,
    );
    assert.deepEqual(bodyReads, []);
    assert.deepEqual(reads, [directoryPageRead(root, activeCollection.position)]);
    assert.deepEqual(fresh.head.entityDirectory.identities, identities);
    assert.deepEqual(fresh.head.entityDirectory.latestUpdates, latestUpdates);
    assert.notDeepEqual(fresh.head.entityDirectory.activeCollection, activeCollection);

    const readLatest = () =>
      cold.usingSnapshot(async (snapshot) =>
        (await transactions.getLatestMany({ snapshot, collection: "messages", keys: ["m"] })).get(
          "m",
        ),
      );
    assert.equal((await readLatest()).value, 5);
    assert.deepEqual(await transactions.projectLatestUpdates(), { sequence: 5, projected: true });
    assert.equal((await readLatest()).value, 5);

    const projected = await PartitionJournal.open({ root, sessionId });
    t.after(() => projected.close());
    assert.equal(projected.head.deferredEntityUpdates, null);
    const projectedReader = new PartitionTransactions(projected);
    const { result, reads: projectedReads } = await observeDirectoryPageReads(() =>
      projected.usingSnapshot((snapshot) =>
        projectedReader.lookupLatestMany({ snapshot, collection: "messages", keys: ["m"] }),
      ),
    );
    assert.equal(result.get("m").reference.record.sequence, 5);
    assert.deepEqual(projectedReads, [
      directoryPageRead(root, projected.head.entityDirectory.activeCollection.position),
    ]);
  });
}

for (const pageBytes of [4096, 8192]) {
  test(`cold projection covers root growth and split paths within the committed reservation (${pageBytes} bytes per page)`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, {
      pageBytes,
      partitionBytes: 128 * 1024,
      partitionRecords: 256,
      receiptRecords: 1,
    });
    let sequence = 0;
    const keys = Array.from(
      { length: 50 },
      (_, i) => `message-${i.toString().padStart(2, "0")}-é-"\\`,
    );
    const owners = new Map();
    const commit = (writer, mutations) => {
      const expectedGeneration = sequence++;
      return commitFixtureTransaction(writer, {
        epoch: journal.head.epoch,
        sequence,
        expectedGeneration,
        operationId: `test-operation-${expectedGeneration}`,
        input: { fixtureGeneration: expectedGeneration },
        mutations,
        result: null,
      });
    };
    const mutate = (key, owner, value) => ({ collection: "messages", key, owner, value });
    let instance = journal;
    let writer = new PartitionTransactions(instance);
    for (const key of keys) {
      const result = await commit(writer, [mutate(key, null, 0)]);
      owners.set(key, result.mutations[0].owner);
    }
    for (const [round, selected] of [
      keys.slice(0, 2),
      keys,
      keys.filter((_, i) => i % 2 === 0),
      Array(16).fill(keys[0]),
    ].entries()) {
      const beforeUpdates = instance.head;
      for (const key of selected) await commit(writer, [mutate(key, owners.get(key), round + 1)]);
      const createdDuringProjection = Array.from({ length: 12 }, (_, i) => `zzz-${i}`);
      if (round === 3) {
        for (const key of createdDuringProjection) await commit(writer, [mutate(key, null, key)]);
        await commit(writer, []);
      }
      const pending = instance.head;
      assert.deepEqual(pending.deferredEntityUpdates, {
        start: beforeUpdates.tail,
        mutationCount: selected.length,
      });
      assert.equal(pending.tail.partition, beforeUpdates.tail.partition);
      await instance.close();
      instance = await PartitionJournal.open({ root, sessionId });
      const opened = instance;
      t.after(() => opened.close());
      writer = new PartitionTransactions(instance);
      const catalog = path.dirname(entityDirectoryPath(root, 0));
      const previousSegments = new Set(await readdir(catalog));
      const bodyReads = [];
      const { result, reads } = await observeDirectoryPageReads(
        () => writer.projectLatestUpdates(),
        (file, flags) => {
          if (flags === "r" && String(file).endsWith("records.log")) bodyReads.push(file);
        },
      );
      assert.deepEqual(result, { sequence, projected: true });
      assert.deepEqual(bodyReads, []);
      if (round === 3) {
        const baseReads = [];
        for (const [i, [file, offset, bytes]] of reads.entries()) {
          const page = (await readFile(file)).subarray(offset, offset + bytes);
          if (page[0] !== PARTITION_ENTITY_PAGE_CODEC.delta) continue;
          const segment = Number(path.basename(file, ".pages"));
          const { base } = decodePartitionEntityPageDelta(
            page.subarray(1).toString("utf8"),
            pending,
            { segment, offset, bytes },
          );
          const expected = directoryPageRead(root, base);
          assert.deepEqual(reads[i + 1], expected);
          assert.notEqual(
            (await readFile(expected[0]))[base.offset],
            PARTITION_ENTITY_PAGE_CODEC.delta,
          );
          baseReads.push(expected);
        }
        assert.ok(baseReads.length >= 1);
        assert.equal(
          reads.length - baseReads.length,
          pending.entityDirectory.activeCollection.level +
            pending.entityDirectory.latestUpdates.level +
            2,
        );
      }
      const newSegments = (await readdir(catalog)).filter((name) => !previousSegments.has(name));
      const writtenBytes = instance.work.entityDirectoryWriteBytesByLevel.reduce(
        (total, bytes) => total + bytes,
        0,
      );
      await instance.usingSnapshot(async (snapshot) => {
        assert.equal(snapshot.deferredEntityUpdates, null);
        assert.deepEqual(snapshot.entityDirectory.identities, pending.entityDirectory.identities);
        assert.equal(writtenBytes, snapshot.entityDirectory.bytes - pending.entityDirectory.bytes);
        assert.equal(
          newSegments.length,
          snapshot.entityDirectory.segment - pending.entityDirectory.segment,
        );
        assert.ok(
          partitionJournalReservedBytes(snapshot) <= partitionJournalReservedBytes(pending),
        );
        assert.ok(
          partitionJournalReservedInodes(snapshot) <= partitionJournalReservedInodes(pending),
        );
        const node = await readEntityDirectoryNode(
          instance,
          snapshot,
          snapshot.entityDirectory.latestUpdates.position,
        );
        assert.ok(round === 0 ? node.level === 0 : node.level >= (pageBytes === 4096 ? 2 : 1));
        for (const [i, key] of keys.entries()) {
          const found = await writer.getLatestMany({
            snapshot,
            collection: "messages",
            keys: [key],
          });
          const expected =
            round === 0
              ? Number(i < 2)
              : round === 3 && i === 0
                ? 4
                : round >= 2 && i % 2 === 0
                  ? 3
                  : 2;
          assert.equal(found.get(key).value, expected, key);
        }
        if (round === 3) {
          const created = await writer.getLatestMany({
            snapshot,
            collection: "messages",
            keys: createdDuringProjection.slice(0, 1),
          });
          assert.equal(created.get(createdDuringProjection[0]).value, createdDuringProjection[0]);
        }
      });
    }
  });
}

test("a cold partition lookup stops at the root for keys above its maximum", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    partitionBytes: 128 * 1024,
    partitionRecords: 256,
  });
  const writer = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 50; sequence += 1) {
    await commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `create-${sequence}`,
      input: {},
      mutations: [{ collection: "messages", key: `m-${sequence}`, owner: null, value: sequence }],
      result: null,
    });
  }
  const active = journal.head.entityDirectory.activeCollection;
  assert.ok(active.level > 0);
  await journal.close();
  const lookupCold = async (keys) => {
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      const reader = new PartitionTransactions(cold);
      return await cold.usingSnapshot((snapshot) =>
        observeDirectoryPageReads(() =>
          reader.lookupMany({
            snapshot,
            partition: snapshot.tail.partition,
            collection: "messages",
            keys,
          }),
        ),
      );
    } finally {
      await cold.close();
    }
  };
  const { result, reads } = await lookupCold(["z"]);
  assert.equal(result.get("z"), null);
  const { position } = active;
  const rootRead = directoryPageRead(root, position);
  const rootPage = (await readFile(rootRead[0])).subarray(
    position.offset,
    position.offset + position.bytes,
  );
  assert.equal(rootPage[0], PARTITION_ENTITY_PAGE_CODEC.delta);
  const delta = decodePartitionEntityPageDelta(
    rootPage.subarray(1).toString("utf8"),
    journal.head,
    position,
  );
  assert.equal(delta.level, active.level);
  assert.deepEqual(reads, [rootRead, directoryPageRead(root, delta.base)]);
  const { result: hit, reads: hitReads } = await lookupCold(["m-1"]);
  const { result: mixed, reads: mixedReads } = await lookupCold(["m-1", "z"]);
  assert.equal(hit.get("m-1").record.sequence, 1);
  assert.deepEqual(mixed.get("m-1"), hit.get("m-1"));
  assert.equal(mixed.get("z"), null);
  assert.deepEqual(mixedReads, hitReads);
});

test("a published root at the wrong level fails lookup and projection without publishing", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const commit = (sequence, key, owner) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: [{ collection: "messages", key, owner, value: sequence }],
      result: null,
    });
  const first = await commit(1, "first", null);
  const projected = await commit(2, "first", first.mutations[0].owner);
  await writer.projectLatestUpdates();
  const second = await commit(3, "second", null);
  assert.ok(second.reference.partition > projected.reference.partition);
  await commit(4, "second", second.mutations[0].owner);
  const head = structuredClone(journal.head);
  assert.equal(head.entityDirectory.latestUpdates.level, 0);
  head.entityDirectory.latestUpdates.level = 1;
  await journal.close();
  await publishJournalHead(journal, head);
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const corruption = {
    code: "SESSION_STORAGE_CORRUPT",
    message: "Entity directory page boundary mismatch",
  };
  await reopened.usingSnapshot((snapshot) =>
    assert.rejects(
      reader.lookupLatestMany({ snapshot, collection: "messages", keys: ["first"] }),
      corruption,
    ),
  );
  await assert.rejects(reader.projectLatestUpdates(), corruption);
  assert.deepEqual(await readFile(current), before);
});

test("a mismatched child update summary on a visited path rejects reads and projection", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    partitionBytes: 128 * 1024,
    partitionRecords: 256,
  });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const commit = (mutations) => {
    const expectedGeneration = journal.head.sequence;
    return commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence: expectedGeneration + 1,
      expectedGeneration,
      operationId: `test-operation-${expectedGeneration}`,
      input: { fixtureGeneration: expectedGeneration },
      mutations,
      result: null,
    });
  };
  const key = "m-00";
  const {
    mutations: [{ owner }],
  } = await commit([{ collection, key, owner: null, value: 0 }]);
  for (let i = 1; i <= 50; i += 1)
    await commit([{ collection, key: `z-${i}`, owner: null, value: i }]);
  await commit([{ collection, key, owner, value: "updated" }]);
  const updateSequence = journal.head.sequence;
  await commit([]);

  const head = structuredClone(journal.head);
  const active = head.entityDirectory.activeCollection;
  const page = structuredClone(await readEntityDirectoryNode(journal, head, active.position));
  assert.ok(page.level > 0);
  assert.equal(page.entries[0][2], updateSequence);

  page.entries[0][2] = head.sequence;
  const directory = new EntityDirectoryAppend(journal, journal.head);
  directory.directory.activeCollection = { position: directory.append(page), level: page.level };
  directory.plan(head);
  await directory.persist();
  await journal.close();
  await publishJournalHead(journal, head);

  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const corruption = {
    code: "SESSION_STORAGE_CORRUPT",
    message: "Entity directory page boundary mismatch",
  };
  await reopened.usingSnapshot(async (snapshot) => {
    const rootPage = await readEntityDirectoryNode(
      reopened,
      snapshot,
      snapshot.entityDirectory.activeCollection.position,
    );
    assert.equal(rootPage.entries[0][2], snapshot.sequence);
    await assert.rejects(
      reader.lookupLatestMany({ snapshot, collection, keys: [key] }),
      corruption,
    );
  });
  await assert.rejects(reader.projectLatestUpdates(), corruption);
  assert.deepEqual(await readFile(current), before);
});
