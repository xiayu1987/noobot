/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_ENTITY_DIRECTORY,
  PARTITION_ENTITY_PAGE_CODEC,
  partitionEntityPageCapacity,
} from "@noobot/session-protocol/partition-entity-directory";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  EntityDirectoryAppend,
  entityDirectoryPath,
  readEntityDirectoryNode,
} from "../../src/session/partition-storage/entity-directory-io.js";
import { publishJournalHead } from "../../src/session/partition-storage/journal-io.js";
import { withCurrentJournalSnapshot } from "../../src/session/partition-storage/journal-snapshots.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";

test("migration publication guard rejects a same-sequence directory republication", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 2, batchRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  const commit = (sequence, owner) =>
    commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `migration-guard-${sequence}`,
      input: { sequence },
      mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
      result: null,
    });
  const created = await commit(1, null);
  await commit(2, created.mutations[0].owner);
  await journal.usingSnapshot(async (before) => {
    assert.notEqual(before.deferredEntityUpdates, null);
    assert.deepEqual(await transactions.projectLatestUpdates(), {
      sequence: before.sequence,
      projected: true,
    });
    await assert.rejects(
      withCurrentJournalSnapshot(journal, before, () => assert.fail("stale publication accepted")),
      { code: "SESSION_MIGRATION_TARGET_CHANGED" },
    );
    await journal.usingSnapshot(async (after) => {
      assert.equal(after.sequence, before.sequence);
      assert.equal(after.deferredEntityUpdates, null);
      assert.equal(await withCurrentJournalSnapshot(journal, after, () => "current"), "current");
    });
  });
});

test("directory publication relocates shared pages once and drops unreferenced pages", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "test-operation-0",
    input: { fixtureGeneration: 0 },
    mutations: [{ collection: "messages", key: "m", owner: null, value: "value" }],
    result: null,
  });

  const snapshot = journal.head;
  const leaf = await readEntityDirectoryNode(
    journal,
    snapshot,
    snapshot.entityDirectory.identities.position,
  );
  const directory = new EntityDirectoryAppend(journal, snapshot);
  const prefix = directory.append(leaf);
  const prefixPage = directory.pages.values().next().value;
  directory.directory.latestUpdates = { level: 0, position: prefix };
  const discarded = directory.append(leaf);
  const child = directory.append(leaf);
  directory.directory.identities = { level: 0, position: child };
  directory.directory.activeCollection = {
    level: 1,
    position: directory.append({ ...leaf, level: 1, entries: [[leaf.entries[0][0], child, 0]] }),
  };

  const next = structuredClone(snapshot);
  directory.plan(next);
  const { identities, latestUpdates, activeCollection } = next.entityDirectory;
  assert.deepEqual(latestUpdates.position, prefix);
  assert.equal(directory.pages.values().next().value, prefixPage);
  assert.deepEqual(identities.position, discarded);
  assert.equal(directory.pages.size, 3);
  assert.equal(
    next.entityDirectory.bytes - snapshot.entityDirectory.bytes,
    prefix.bytes + identities.position.bytes + activeCollection.position.bytes,
  );
  await directory.persist();
  const parent = await readEntityDirectoryNode(journal, next, activeCollection.position);
  assert.deepEqual(parent.entries, [[leaf.entries[0][0], identities.position, 0]]);
  assert.deepEqual(await readEntityDirectoryNode(journal, next, identities.position), leaf);
});

test("directory publication does not retain an unpublished delta base", async (t) => {
  const { journal } = await createTransactionCase(t);
  await commitFixtureTransaction(new PartitionTransactions(journal), {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: "test-operation-0",
    input: { fixtureGeneration: 0 },
    mutations: Array.from({ length: 8 }, (_, index) => ({
      collection: "messages",
      key: `message-${index}`,
      owner: null,
      value: index,
    })),
    result: null,
  });
  const snapshot = journal.head;
  const writer = new EntityDirectoryAppend(journal, snapshot);
  const prior = await writer.read(snapshot.entityDirectory.identities.position);
  const unreachablePrefix = writer.append(prior);
  const unpublished = writer.append(prior);
  const entries = [...prior.entries, ['["messages","message-8"]', prior.entries[0][1]]];
  const position = writer.appendReplacementIfFits({ ...prior, entries }, unpublished, prior);
  assert.notEqual(position, null);
  writer.directory.identities = { level: 0, position };

  const next = structuredClone(snapshot);
  writer.plan(next);
  const relocated = next.entityDirectory.identities.position;
  assert.notDeepEqual(relocated, position);
  assert.equal(relocated.segment, unreachablePrefix.segment);
  assert.equal(relocated.offset, unreachablePrefix.offset);
  assert.equal(writer.pages.size, 1);
  assert.equal(next.entityDirectory.bytes - snapshot.entityDirectory.bytes, relocated.bytes);
  await writer.persist();
  assert.deepEqual((await readEntityDirectoryNode(journal, next, relocated)).entries, entries);
});

test("right-edge growth retains full leaves and branches across cold reopen", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { pageBytes: 4096 });
  const transactions = new PartitionTransactions(journal);
  const key = (sequence) => `message-${String(sequence).padStart(6, "0")}`;
  const commit = (sequence) =>
    commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: [{ collection: "messages", key: key(sequence), owner: null, value: sequence }],
      result: null,
    });
  const leafSize = PARTITION_ENTITY_DIRECTORY.maxEntries;
  const branchSize = leafSize * partitionEntityPageCapacity(journal.head.limits);
  for (let sequence = 1; sequence <= branchSize; sequence += 1) {
    const priorRoot = journal.head.entityDirectory.identities;
    await commit(sequence);
    const { activeCollection, identities, bytes } = journal.head.entityDirectory;
    if (journal.head.tail.partition === 0) assert.deepEqual(activeCollection, identities);
    if (sequence === 1) assert.equal(bytes, identities.position.bytes);
    if (sequence === leafSize + 1) {
      const { level, position } = journal.head.entityDirectory.identities;
      assert.equal(level, 1);
      const page = await readEntityDirectoryNode(journal, journal.head, position);
      assert.deepEqual(page.entries[0][1], priorRoot.position);
    }
  }
  await journal.usingSnapshot(async (previous) => {
    const nextSequence = branchSize + 1;
    const keys = [key(branchSize), key(nextSequence)];
    await commit(nextSequence);
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    await cold.usingSnapshot(async (snapshot) => {
      const { level, position } = snapshot.entityDirectory.identities;
      assert.equal(level, 2);
      const page = await readEntityDirectoryNode(cold, snapshot, position);
      assert.deepEqual(page.entries[0][1], previous.entityDirectory.identities.position);
      const query = { collection: "messages", keys };
      const prior = await transactions.getLatestMany({ ...query, snapshot: previous });
      const latest = await new PartitionTransactions(cold).getLatestMany({ ...query, snapshot });
      assert.equal(prior.get(keys[0]).value, branchSize);
      assert.equal(prior.get(keys[1]), null);
      assert.equal(latest.get(keys[0]).value, branchSize);
      assert.equal(latest.get(keys[1]).value, nextSequence);
    });
  });
});

test("diverged directory roots publish a shared creation leaf only once", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    transactionBytes: 16 * 1024,
  });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const create = (key, value) => ({ collection, key, value, owner: null });
  const commit = (sequence, mutations) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations,
      result: null,
    });
  const seeded = await commit(
    1,
    Array.from({ length: 40 }, (_, index) => create(`m${index + 10}`, index)),
  );
  const pages = async (reader, snapshot) => {
    const { identities, activeCollection } = snapshot.entityDirectory;
    assert.notDeepEqual(identities, activeCollection);
    assert.equal(identities.level, 1);
    assert.equal(activeCollection.level, 1);
    return Promise.all(
      [identities, activeCollection].map(({ position }) =>
        readEntityDirectoryNode(reader, snapshot, position),
      ),
    );
  };
  const update = { ...create("m10", "updated"), owner: seeded.mutations[0].owner };
  await commit(2, [update]);
  await journal.usingSnapshot(async (previous) => {
    const [oldIdentity, oldActive] = await pages(journal, previous);
    assert.deepEqual(oldIdentity.entries.at(-1), oldActive.entries.at(-1));
    await commit(3, [{ ...update, value: "updated again" }, create("m50", "new")]);
    await assert.rejects(commit(4, [create("m50", "duplicate")]), {
      code: "SESSION_ENTITY_EXISTS",
    });
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    await cold.usingSnapshot(async (snapshot) => {
      const [identity, active] = await pages(cold, snapshot);
      const shared = identity.entries.at(-1);
      assert.notDeepEqual(shared, oldIdentity.entries.at(-1));
      assert.deepEqual(shared, active.entries.at(-1));
      const query = { collection, keys: ["m10", "m50"] };
      const previousValues = await writer.getLatestMany({ ...query, snapshot: previous });
      assert.equal(previousValues.get("m10").value, "updated");
      assert.equal(previousValues.get("m50"), null);
      const current = await new PartitionTransactions(cold).getLatestMany({ ...query, snapshot });
      assert.equal(current.get("m10").value, "updated again");
      assert.equal(current.get("m50").value, "new");
    });
  });
});

test("leaf deltas reuse one base across commits and reject a damaged base on cold read", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const key = (index) => `message-${createHash("sha256").update(String(index)).digest("hex")}`;
  const commit = (sequence, mutations) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations,
      result: null,
    });
  const seeded = await commit(
    1,
    Array.from({ length: 16 }, (_, index) => ({
      collection,
      key: key(index),
      owner: null,
      value: index,
    })),
  );
  const base = journal.head.entityDirectory.activeCollection.position;
  const update = (sequence) =>
    commit(sequence, [
      {
        collection,
        key: key(0),
        owner: seeded.mutations[0].owner,
        value: sequence,
      },
    ]);
  const codec = async ({ segment, offset }) =>
    (await readFile(entityDirectoryPath(root, segment)))[offset];
  const query = { collection, keys: [key(0), key(1)] };
  await journal.usingSnapshot(async (previous) => {
    await update(2);
    await update(3);
    const position = journal.head.entityDirectory.activeCollection.position;
    assert.equal(await codec(position), PARTITION_ENTITY_PAGE_CODEC.delta);
    assert.ok(position.bytes < base.bytes / 2);
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      const read = cold.work.readBytes;
      const node = await readEntityDirectoryNode(cold, cold.head, position);
      assert.equal(cold.work.readBytes - read, position.bytes + base.bytes);
      assert.equal(node.entries.length, 16);
      await cold.usingSnapshot(async (snapshot) => {
        const latest = await new PartitionTransactions(cold).getLatestMany({ ...query, snapshot });
        assert.equal(latest.get(key(0)).value, 3);
        assert.equal(latest.get(key(1)).value, 1);
      });
    } finally {
      await cold.close();
    }
    const prior = await writer.getLatestMany({ ...query, snapshot: previous });
    assert.equal(prior.get(key(0)).value, 0);
  });
  const file = entityDirectoryPath(root, base.segment);
  const bytes = await readFile(file);
  bytes[base.offset] = 255;
  await writeFile(file, bytes);
  const damaged = await PartitionJournal.open({ root, sessionId });
  await damaged.usingSnapshot(async (snapshot) => {
    await assert.rejects(new PartitionTransactions(damaged).getLatestMany({ ...query, snapshot }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });
  await assert.rejects(damaged.close(), { code: "SESSION_STORAGE_CORRUPT" });
});

test("a retained lookup keeps its version across another writer's publication", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const commit = (transactions, sequence, owner) =>
    commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations: [{ collection: "messages", key: "m", owner, value: sequence }],
      result: null,
    });
  const created = await commit(writer, 1, null);
  const { owner } = created.mutations[0];
  await commit(writer, 2, owner);
  await journal.usingSnapshot(async (previous) => {
    const next = await PartitionJournal.open({ root, sessionId });
    t.after(() => next.close());
    const query = { snapshot: previous, collection: "messages", keys: ["m"] };
    const nextWriter = new PartitionTransactions(next);
    await commit(nextWriter, 3, owner);
    assert.equal((await writer.lookupLatestMany(query)).get("m").reference.record.sequence, 2);
    await journal.usingSnapshot(async (snapshot) => {
      const latest = await writer.lookupLatestMany({ ...query, snapshot });
      assert.equal(latest.get("m").reference.record.sequence, 3);
    });
  });
});

for (const scope of ["latest", "local"]) {
  test(`${scope} entity reads reject a valid directory page with the wrong creation owner`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
    const writer = new PartitionTransactions(journal);
    const commit = (sequence, mutations) =>
      commitFixtureTransaction(writer, {
        epoch: journal.head.epoch,
        sequence,
        expectedGeneration: sequence - 1,
        operationId: `test-operation-${sequence - 1}`,
        input: { fixtureGeneration: sequence - 1 },
        mutations,
        result: null,
      });
    const collection = "messages";
    const created = await commit(1, [
      { collection, key: "m1", owner: null, value: "original" },
      { collection, key: "m2", owner: null, value: "other" },
    ]);
    const [original, other] = created.mutations;
    const updated = await commit(2, [
      { collection, key: "m1", owner: original.owner, value: "updated" },
    ]);
    const identities = journal.head.entityDirectory.identities;
    await writer.projectLatestUpdates();
    if (scope === "latest") await commit(3, []);
    const snapshot = await journal.snapshot();
    assert.deepEqual(snapshot.entityDirectory.identities, identities);
    assert.equal(snapshot.deferredEntityUpdates, null);
    const query = { snapshot, collection, keys: ["m1"] };
    const read = (transactions, input) =>
      scope === "latest"
        ? transactions.getLatestMany(input)
        : transactions.getMany({ ...input, partition: 0 });
    assert.equal((await read(writer, query)).get("m1").value, "updated");
    const rootKey = scope === "latest" ? "latestUpdates" : "activeCollection";
    const page = structuredClone(
      await readEntityDirectoryNode(journal, snapshot, snapshot.entityDirectory[rootKey].position),
    );
    assert.equal(page.level, 0);
    const [, entry] = page.entries[0];
    assert.deepEqual(entry.owner, original.owner);
    assert.deepEqual(entry.reference, updated.mutations[0].reference);
    entry.owner = other.owner;
    const directory = new EntityDirectoryAppend(journal, snapshot);
    const altered = directory.append(page);
    directory.directory[rootKey] = { position: altered, level: page.level };
    const head = structuredClone(snapshot);
    directory.plan(head);
    await directory.persist();
    await publishJournalHead(journal, head);

    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = new PartitionTransactions(reopened);
    const latest = await reopened.snapshot();
    const alteredQuery = { ...query, snapshot: latest };
    try {
      if (scope === "latest") {
        const listed = await reader.lookupLatestMany(alteredQuery);
        assert.deepEqual(listed.get("m1").owner, other.owner);
      } else {
        const listed = await reader.lookupMany({ ...alteredQuery, partition: 0 });
        assert.deepEqual(listed.get("m1"), entry.reference);
      }
      await assert.rejects(read(reader, alteredQuery), {
        code: "SESSION_STORAGE_IDENTITY",
        message: "Entity reference owner mismatch",
      });
    } finally {
      await reopened.releaseSnapshot(latest);
      await journal.releaseSnapshot(snapshot);
    }
  });
}

test("directory appends sync page data and publish new segment entries before CURRENT", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionBytes: 4096 });
  const transactions = new PartitionTransactions(journal);
  const adapter = getFsAdapter();
  const catalog = path.join(root, "catalog");
  const events = [];
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      const kind =
        String(file) === catalog ? "directory" : String(file).endsWith(".pages") ? "pages" : null;
      if (kind === null) return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync")
            return async () => {
              await target.sync();
              events.push(kind);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async rename(source, target) {
      await adapter.rename(source, target);
      if (String(target) === path.join(root, "CURRENT")) events.push("CURRENT");
    },
  });
  let rolled = false;
  try {
    for (let sequence = 1; sequence <= 128; sequence += 1) {
      events.length = 0;
      const before = journal.head.entityDirectory;
      if (before.offset > 0)
        await appendFile(entityDirectoryPath(root, before.segment), "unpublished suffix");
      await commitFixtureTransaction(transactions, {
        epoch: journal.head.epoch,
        sequence,
        expectedGeneration: sequence - 1,
        operationId: `test-operation-${sequence - 1}`,
        input: { fixtureGeneration: sequence - 1 },
        mutations: [{ collection: "messages", key: `m${sequence}`, owner: null, value: sequence }],
        result: null,
      });
      rolled = before.segment !== journal.head.entityDirectory.segment;
      assert.deepEqual(
        events.slice(events.indexOf("pages")),
        rolled
          ? ["pages", "pages", "directory", "CURRENT"]
          : sequence === 1
            ? ["pages", "directory", "CURRENT"]
            : ["pages", "CURRENT"],
      );
      if (rolled) {
        const sealed = await readFile(entityDirectoryPath(root, before.segment));
        assert.ok(sealed.length >= before.offset);
        assert.ok(sealed.length <= journal.head.limits.partitionBytes);
        assert.equal(sealed.includes("unpublished suffix", before.offset), false);
        assert.equal(
          journal.head.entityDirectory.bytes - before.bytes,
          sealed.length - before.offset + journal.head.entityDirectory.offset,
        );
        break;
      }
    }
  } finally {
    setFsAdapter(adapter);
  }
  assert.ok(rolled, "the workload must create a successor segment");
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const snapshot = await reopened.snapshot();
  try {
    const values = await new PartitionTransactions(reopened).getLatestMany({
      snapshot,
      collection: "messages",
      keys: [`m${snapshot.sequence}`],
    });
    assert.equal(values.get(`m${snapshot.sequence}`).value, snapshot.sequence);
  } finally {
    await reopened.releaseSnapshot(snapshot);
  }
});

test("one transaction updates multiple directory leaves without changing a retained snapshot", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    transactionBytes: 16 * 1024,
  });
  const writer = new PartitionTransactions(journal);
  const collection = "messages";
  const original = Array.from({ length: 64 }, (_, index) => ({
    collection,
    key: `m${String(index + 10)}`,
    owner: null,
    value: index,
  }));
  const commit = (sequence, mutations) =>
    commitFixtureTransaction(writer, {
      epoch: journal.head.epoch,
      sequence,
      expectedGeneration: sequence - 1,
      operationId: `test-operation-${sequence - 1}`,
      input: { fixtureGeneration: sequence - 1 },
      mutations,
      result: null,
    });
  const first = await commit(1, original);
  const previous = await journal.snapshot();
  const updates = [63, 31, 0].map((index) => ({
    ...original[index],
    owner: first.mutations[index].owner,
    value: `updated-${index}`,
  }));
  const identityRoot = previous.entityDirectory.identities;
  assert.equal(identityRoot.level, 1);
  await readEntityDirectoryNode(journal, previous, identityRoot.position);
  const { reads: publicationReads } = await observeDirectoryPageReads(() =>
    commit(2, [
      ...updates,
      { collection, key: "m99", owner: null, value: "new" },
      { collection, key: "m00", owner: null, value: "new" },
    ]),
  );
  assert.deepEqual(
    publicationReads,
    [],
    "compact identity leaves stay cached throughout this publication",
  );
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const keys = ["m00", "m73", "m10", "m99", "m20", "m41"];
  const latest = await reopened.snapshot();
  try {
    const before = await writer.getLatestMany({ snapshot: previous, collection, keys });
    const { result: after, reads } = await observeDirectoryPageReads(async (observedReads) => {
      const query = {
        snapshot: latest,
        collection,
        keys: updates.map(({ key }) => key),
      };
      const beforeLookup = reopened.work.readBytes;
      const references = await reader.lookupLatestMany(query);
      const afterLookup = reopened.work.readBytes;
      assert.ok(afterLookup > beforeLookup, "cold lookup reads published locator pages");
      assert.deepEqual(
        [...references.values()].map(({ reference }) => reference.record.sequence),
        [2, 2, 2],
      );
      assert.deepEqual(await reader.lookupLatestMany(query), references);
      assert.equal(reopened.work.readBytes, afterLookup, "same snapshot reuses locator pages");
      await reopened.usingSnapshot(async (snapshot) => {
        assert.notEqual(snapshot, latest);
        const beforeReads = observedReads.length;
        assert.deepEqual(await reader.lookupLatestMany({ ...query, snapshot }), references);
        assert.equal(observedReads.length, beforeReads, "new snapshot reuses published pages");
      });
      return reader.getLatestMany({ snapshot: latest, collection, keys });
    });
    assert.ok(reads.length > 3, "cold batch reads local and identity locator pages");
    assert.equal(new Set(reads.map(JSON.stringify)).size, reads.length, "no page is read twice");
    assert.deepEqual([...after.keys()], keys);
    assert.deepEqual(
      keys.map((key) => before.get(key)?.value),
      [undefined, 63, 0, undefined, 10, 31],
    );
    assert.deepEqual(
      keys.map((key) => after.get(key)?.value),
      ["new", "updated-63", "updated-0", "new", 10, "updated-31"],
    );
  } finally {
    await journal.releaseSnapshot(previous);
    await reopened.releaseSnapshot(latest);
  }
});
