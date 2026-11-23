/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { truncate } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { partitionCollectionResultBytes } from "@noobot/session-protocol/partition-collection-query";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { readEntityDirectoryNode } from "../../src/session/partition-storage/entity-directory-io.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  directoryPageRead,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

test("collection results enforce the exact UTF-8 JSON byte budget", () => {
  const result = ["消息", { escaped: '\n"\\', emoji: "😀", surrogate: "\ud800", number: 1 }];
  const bytes = Buffer.byteLength(JSON.stringify(result));
  assert.equal(partitionCollectionResultBytes(result, bytes), bytes);
  assert.throws(() => partitionCollectionResultBytes(result, bytes - 1), {
    code: "SESSION_QUERY_BUDGET",
  });
  assert.throws(() => partitionCollectionResultBytes({ value: undefined }, bytes), TypeError);
});

test("cold owner lookup skips update branches older than the entity", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 80 });
  const writer = new PartitionTransactions(journal);
  const created = [];
  for (let index = 0; index < 40; index += 1) {
    const key = `m${String(index).padStart(2, "0")}`;
    const { mutations } = await commitFixtureTransaction(
      writer,
      input(journal, index + 1, [put(key, 1)]),
    );
    created.push(mutations[0]);
  }
  for (const [index, { key, owner }] of created.entries()) {
    await commitFixtureTransaction(writer, input(journal, 41 + index, [put(key, 2, owner)]));
  }
  await writer.projectLatestUpdates();
  const targetKey = "m00a";
  const {
    mutations: [target],
  } = await commitFixtureTransaction(writer, input(journal, 81, [put(targetKey, 3)]));
  for (let sequence = 82; sequence <= 161; sequence += 1)
    await commitFixtureTransaction(writer, input(journal, sequence, []));
  const child = await journal.usingSnapshot(async (snapshot) => {
    const { position } = snapshot.entityDirectory.latestUpdates;
    const page = await readEntityDirectoryNode(journal, snapshot, position);
    assert.ok(page.level > 0);
    const [bound, childPosition, watermark] = page.entries[0];
    assert.ok(bound >= JSON.stringify(["messages", targetKey]));
    assert.ok(watermark < target.owner.sequence);
    return directoryPageRead(root, childPosition);
  });
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  await cold.usingSnapshot(async (snapshot) => {
    const read = (key, owner) =>
      reader.getLatestByOwner({ snapshot, collection: "messages", entities: [{ key, owner }] });
    const { result, reads } = await observeDirectoryPageReads(() => read(targetKey, target.owner));
    assert.equal(result.get(targetKey).value, 3);
    assert.ok(!reads.some(([file, offset]) => file === child[0] && offset === child[1]));
    const { key, owner } = created[0];
    assert.equal((await read(key, owner)).get(key).value, 2);
    await assert.rejects(read(key, target.owner), { code: "SESSION_STORAGE_IDENTITY" });
  });
});

test("owner lookup combines a sealed local version with newer projected updates only", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  const { mutations } = await commitFixtureTransaction(
    writer,
    input(journal, 1, [put("a", 1), put("b", 1)]),
  );
  const [a, b] = mutations.map(({ owner }) => owner);
  await commitFixtureTransaction(writer, input(journal, 2, [put("a", 2, a)]));
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, input(journal, 3, [put("b", 3, b)]));
  await writer.projectLatestUpdates();
  await commitFixtureTransaction(writer, input(journal, 4, []));
  await commitFixtureTransaction(writer, input(journal, 5, []));

  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = new PartitionTransactions(cold);
  await cold.usingSnapshot(async (snapshot) => {
    const values = await reader.getLatestByOwner({
      snapshot,
      collection: "messages",
      entities: [
        { key: "a", owner: a },
        { key: "b", owner: b },
      ],
    });
    assert.equal(values.get("a").value, 2);
    assert.equal(values.get("b").value, 3);
  });
});

function input(journal, sequence, mutations) {
  return {
    epoch: journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations,
    result: null,
  };
}

function query(snapshot, partition, keys) {
  return { snapshot, partition, collection: "messages", keys };
}

function put(key, value, owner = null) {
  return { collection: "messages", key, owner, value };
}

test("partition pages never fill spare capacity from the adjacent partition", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 5; sequence += 1)
    await commitFixtureTransaction(
      transactions,
      input(journal, sequence, [put(`m${sequence}`, sequence)]),
    );
  await journal.usingSnapshot(async (snapshot) => {
    const page = await journal.readPartitionPage({
      snapshot,
      cursor: { partition: 0, offset: 0, sequence: 0 },
    });
    assert.deepEqual(
      page.records.map(({ request }) => request.sequence),
      [1, 2],
    );
    assert.equal(page.done, true);
    assert.equal(page.next.partition, 1);
  });
});

test("local latest version, explicit deletion and old snapshots survive reopen", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  const first = await commitFixtureTransaction(
    transactions,
    input(journal, 1, [put("m", "first")]),
  );
  const owner = first.mutations[0].owner;
  await journal.usingSnapshot(async (beforeRemoval) => {
    await commitFixtureTransaction(
      transactions,
      input(journal, 2, [{ collection: "messages", key: "m", owner, remove: true }]),
    );
    await transactions.projectLatestUpdates();
    await commitFixtureTransaction(
      transactions,
      input(journal, 3, [put("m", "another-partition", owner)]),
    );
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = new PartitionTransactions(reopened);
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal((await reader.getMany(query(snapshot, 0, ["m"]))).get("m").remove, true);
      assert.equal((await reader.getMany(query(beforeRemoval, 0, ["m"]))).get("m").value, "first");
      assert.equal(
        (await reader.getMany(query(snapshot, 1, ["m"]))).get("m").value,
        "another-partition",
      );
      assert.equal((await reader.getMany(query(snapshot, 1, ["missing"]))).get("missing"), null);
      const results = await Promise.all([
        reader.getMany(query(snapshot, 0, ["m"])),
        reader.getMany(query(beforeRemoval, 0, ["m"])),
        reader.getMany(query(snapshot, 1, ["m"])),
      ]);
      assert.equal(results[0].get("m").remove, true);
      assert.equal(results[1].get("m").value, "first");
      assert.equal(results[2].get("m").value, "another-partition");
    });
  });
});

test("active partition lookup applies only the newly committed tail", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 20; sequence += 1)
    await commitFixtureTransaction(
      transactions,
      input(journal, sequence, [put(`m${sequence}`, sequence)]),
    );
  await journal.usingSnapshot(async (snapshot) => {
    await transactions.lookupMany(query(snapshot, 0, ["m1"]));
    const before = journal.work.readBytes;
    const found = await transactions.lookupMany(query(snapshot, 0, ["m1"]));
    assert.equal(journal.work.readBytes, before);
    assert.throws(() => {
      found.get("m1").slot = 99;
    }, TypeError);
    await commitFixtureTransaction(transactions, input(journal, 21, [put("m21", 21)]));
    await journal.usingSnapshot(async (later) => {
      const start = journal.work.readBytes;
      assert.ok((await transactions.lookupMany(query(later, 0, ["m21"]))).get("m21"));
      assert.ok(journal.work.readBytes - start < journal.head.limits.transactionBytes);
    });
  });
});

test("query identity and count/byte budgets fail without any body I/O", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const valid = query(snapshot, 0, ["m"]);
    const before = journal.work.readBytes;
    for (const invalid of [
      { ...valid, unknown: true },
      { ...valid, partition: 1 },
      { ...valid, keys: ["m", "m"] },
      {
        ...valid,
        keys: Array.from({ length: snapshot.limits.pageRecords + 1 }, (_, i) => String(i)),
      },
      { ...valid, keys: ["x".repeat(snapshot.limits.pageBytes)] },
      { ...valid, snapshot: { ...snapshot, epoch: "f".repeat(32) } },
    ])
      await assert.rejects(transactions.lookupMany(invalid));
    assert.equal(journal.work.readBytes, before);
    assert.equal((await transactions.getMany(valid)).get("m"), null);
  });
});

test("unrepresentable directory keys fail even in an empty snapshot", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const keys = ['"'.repeat(256)];
    assert.ok(Buffer.byteLength(JSON.stringify(keys)) < snapshot.limits.pageBytes);
    const start = journal.work.readBytes;
    const error = { name: "RangeError", message: "Entity identity exceeds page budget" };
    await assert.rejects(transactions.lookupMany(query(snapshot, 0, keys)), error);
    await assert.rejects(
      transactions.lookupLatestMany({ snapshot, collection: "messages", keys }),
      error,
    );
    assert.equal(journal.work.readBytes, start);
  });
});

test("one value page reads each referenced transaction only once", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  await commitFixtureTransaction(transactions, input(journal, 1, [put("a", "A"), put("c", "C")]));
  await commitFixtureTransaction(transactions, input(journal, 2, [put("b", "B")]));
  await journal.usingSnapshot(async (snapshot) => {
    const keys = ["a", "b", "missing", "c"];
    const request = query(snapshot, 0, keys);
    await transactions.lookupMany(request);
    for (const read of [
      () => transactions.getMany(request),
      () => transactions.getLatestMany({ snapshot, collection: "messages", keys }),
    ]) {
      const before = journal.work.partitionOpens;
      const result = await read();
      assert.deepEqual(
        Array.from(result, ([key, mutation]) => [key, mutation?.value ?? null]),
        [
          ["a", "A"],
          ["b", "B"],
          ["missing", null],
          ["c", "C"],
        ],
      );
      assert.equal(journal.work.partitionOpens - before, 2);
    }
  });
});

test("cold active references do not scan transaction bodies", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    partitionRecords: 3,
    receiptRecords: 1,
  });
  const transactions = new PartitionTransactions(journal);
  await commitFixtureTransaction(transactions, input(journal, 1, [put("a", "x".repeat(2400))]));
  await commitFixtureTransaction(transactions, input(journal, 2, [put("b", "x".repeat(2400))]));
  await commitFixtureTransaction(transactions, input(journal, 3, [put("c", 3)]));
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (active) => {
    const { result, work } = await observeStorageIo(root, () =>
      reader.lookupMany(query(active, 0, ["b"])),
    );
    assert.equal(result.get("b").record.sequence, 2);
    assert.ok([...work.readBytesByPath.keys()].every((file) => file.endsWith(".pages")));
    assert.ok(work.readBytes > 0);
    assert.ok(work.readBytes <= active.limits.pageBytes);
  });
});

test("sealed and cross-partition queries count index, directory and frame reads", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    partitionRecords: 1,
  });
  const transactions = new PartitionTransactions(journal);
  for (const sequence of [1, 2]) {
    await commitFixtureTransaction(
      transactions,
      input(journal, sequence, [
        put(`m${sequence}`, sequence),
        put(`large${sequence}`, "x".repeat(2400)),
      ]),
    );
  }
  await commitFixtureTransaction(transactions, input(journal, 3, [put("m3", 3)]));
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    const keys = ["m1", "m2"];
    const { result, work: sealed } = await observeStorageIo(root, () =>
      reader.getMany(query(snapshot, 0, keys)),
    );
    assert.equal(result.get("m1").value, 1);
    assert.equal(result.get("m2"), null);
    const partition = path.relative(root, path.dirname(journalPartitionPath(root, 0)));
    for (const name of ["START", "offsets.idx", "records.log"])
      assert.ok(sealed.readBytesByPath.get(path.join(partition, name)) > 0, name);
    assert.ok(sealed.readBytesByPath.get(path.join(partition, "records.log")) < 512);
    assert.ok([...sealed.readBytesByPath.keys()].some((file) => file.endsWith(".pages")));
    assert.ok(sealed.readBytes <= snapshot.limits.pageBytes);
    const { result: latestValues, work: latest } = await observeStorageIo(root, () =>
      reader.getLatestMany({ snapshot, collection: "messages", keys }),
    );
    assert.deepEqual(
      [...latestValues.values()].map(({ value }) => value),
      [1, 2],
    );
    const recordReads = [...latest.readBytesByPath].filter(([file]) =>
      file.endsWith("records.log"),
    );
    assert.equal(recordReads.length, 2);
    for (const [file, bytes] of recordReads) assert.ok(bytes > 0 && bytes < 512, file);
    const names = [...latest.readBytesByPath.keys()].map((file) => path.basename(file));
    for (const name of ["START", "offsets.idx", "records.log"])
      assert.ok(names.includes(name), name);
    assert.ok(names.some((name) => name.endsWith(".pages")));
    assert.ok(latest.readBytes <= snapshot.limits.pageBytes);
    const { work: overBudget } = await observeStorageIo(root, () =>
      assert.rejects(
        reader.getLatestMany({ snapshot, collection: "messages", keys: ["large1", "large2"] }),
        {
          code: "SESSION_QUERY_BUDGET",
          message: /read byte budget/,
        },
      ),
    );
    assert.ok(overBudget.readBytes <= snapshot.limits.pageBytes);
  });
});

test("cold latest queries skip unprojected transaction bodies within the collection budget", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    pageBytes: 4096,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(writer, input(journal, 1, [put("m", 1)]));
  for (const sequence of [2, 3, 4])
    await commitFixtureTransaction(
      writer,
      input(journal, sequence, [put("m", "x".repeat(2400), created.mutations[0].owner)]),
    );
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.deferredEntityUpdates.mutationCount, 3);
    const request = { snapshot, collection: "messages", keys: ["m"] };
    const { result, work } = await observeStorageIo(root, () => reader.lookupLatestMany(request));
    assert.equal(result.get("m").reference.record.sequence, 4);
    assert.ok(work.readBytes > 0);
    assert.ok([...work.readBytesByPath.keys()].every((file) => file.endsWith(".pages")));
    assert.ok(work.readBytes <= snapshot.limits.pageBytes);
    const { result: values, work: valueIo } = await observeStorageIo(root, () =>
      reader.getLatestMany(request),
    );
    assert.equal(values.get("m").value, "x".repeat(2400));
    assert.ok(valueIo.readBytes <= snapshot.limits.pageBytes);
  });
  assert.deepEqual(await reader.projectLatestUpdates(), { sequence: 4, projected: true });
  await reopened.usingSnapshot(async (snapshot) => {
    const request = { snapshot, collection: "messages", keys: ["m"] };
    assert.equal((await reader.getLatestMany(request)).get("m").value, "x".repeat(2400));
  });
});

test("cold latest lookup merges active deletions, projected updates and creation references", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 2,
    receiptRecords: 1,
  });
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(
    writer,
    input(journal, 1, [put("deleted", 1), put("projected", 1), put("created", 1)]),
  );
  const [deleted, projected, unchanged] = created.mutations;
  const updated = await commitFixtureTransaction(
    writer,
    input(journal, 2, [put("deleted", 2, deleted.owner), put("projected", 2, projected.owner)]),
  );
  assert.deepEqual(await writer.projectLatestUpdates(), { sequence: 2, projected: true });
  const removed = await commitFixtureTransaction(
    writer,
    input(journal, 3, [
      { collection: "messages", key: "deleted", owner: deleted.owner, remove: true },
    ]),
  );
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.tail.partition, 1);
    assert.equal(snapshot.deferredEntityUpdates.start.sequence, 2);
    const request = {
      snapshot,
      collection: "messages",
      keys: ["deleted", "projected", "created", "missing"],
    };
    const { result, work } = await observeStorageIo(root, () => reader.lookupLatestMany(request));
    assert.deepEqual(
      [...result],
      [
        ["deleted", { owner: deleted.owner, reference: removed.mutations[0].reference }],
        ["projected", { owner: projected.owner, reference: updated.mutations[1].reference }],
        ["created", { owner: unchanged.owner, reference: unchanged.reference }],
        ["missing", null],
      ],
    );
    assert.ok(work.readBytes > 0 && work.readBytes <= snapshot.limits.pageBytes);
    assert.ok([...work.readBytesByPath.keys()].every((file) => file.endsWith(".pages")));
    const values = await reader.getLatestMany(request);
    assert.equal(values.get("deleted").remove, true);
    assert.equal(values.get("projected").value, 2);
    assert.equal(values.get("created").value, 1);
    assert.equal(values.get("missing"), null);
    assert.deepEqual(await reader.projectLatestUpdates(), { sequence: 3, projected: true });
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    await cold.usingSnapshot(async (projectedSnapshot) => {
      assert.equal(projectedSnapshot.deferredEntityUpdates, null);
      const projectedReader = new PartitionTransactions(cold);
      const projectedRequest = { ...request, snapshot: projectedSnapshot };
      assert.deepEqual(await projectedReader.lookupLatestMany(projectedRequest), result);
      assert.deepEqual(await projectedReader.getLatestMany(projectedRequest), values);
    });
  });
});

test("latest directory entries cannot modify cached identity or position", async (t) => {
  const { journal } = await createTransactionCase(t);
  const transactions = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(
    transactions,
    input(journal, 1, [put("m", "first")]),
  );
  const updated = await commitFixtureTransaction(
    transactions,
    input(journal, 2, [put("m", "second", created.mutations[0].owner)]),
  );
  const { owner, reference } = updated.mutations[0];
  await journal.usingSnapshot(async (snapshot) => {
    const request = { snapshot, collection: "messages", keys: ["m"] };
    const entry = (await transactions.lookupLatestMany(request)).get("m");
    assert.deepEqual(entry, { owner, reference });
    assert.throws(() => {
      entry.owner.sequence = 2;
    }, TypeError);
    assert.throws(() => {
      entry.reference.record.sequence = 1;
    }, TypeError);
    assert.equal((await transactions.getLatestMany(request)).get("m").value, "second");
    await commitFixtureTransaction(
      transactions,
      input(journal, 3, [put("m", "third", entry.owner)]),
    );
  });
});

test("latest directory entries enforce the result byte budget without opening bodies", async (t) => {
  const { journal } = await createTransactionCase(t, { pageBytes: 4096 });
  const transactions = new PartitionTransactions(journal);
  const keys = Array.from({ length: 8 }, (_, index) => `${index}${"a".repeat(479)}`);
  for (const [index, key] of keys.entries())
    await commitFixtureTransaction(transactions, input(journal, index + 1, [put(key, index)]));
  await journal.usingSnapshot(async (snapshot) => {
    const request = { snapshot, collection: "messages", keys };
    const before = journal.work.partitionOpens;
    for (const key of keys) {
      const entries = await transactions.lookupLatestMany({ ...request, keys: [key] });
      assert.ok(entries.get(key)?.owner);
    }
    await assert.rejects(transactions.lookupLatestMany(request), {
      code: "SESSION_QUERY_BUDGET",
      message: /results exceed byte budget/,
    });
    assert.equal(journal.work.partitionOpens, before);
  });
});

test("warm local references enforce the result byte budget without file reads", async (t) => {
  const { journal, root } = await createTransactionCase(t, { pageBytes: 4096 });
  const transactions = new PartitionTransactions(journal);
  const keys = Array.from({ length: 8 }, (_, index) => `${index}${"a".repeat(479)}`);
  for (const [index, key] of keys.entries())
    await commitFixtureTransaction(transactions, input(journal, index + 1, [put(key, index)]));
  await journal.usingSnapshot(async (snapshot) => {
    for (const [index, key] of keys.entries()) {
      const found = await transactions.lookupMany(query(snapshot, 0, [key]));
      assert.equal(found.get(key).record.sequence, index + 1);
    }
    const { work } = await observeStorageIo(root, () =>
      assert.rejects(transactions.lookupMany(query(snapshot, 0, keys)), {
        code: "SESSION_QUERY_BUDGET",
        message: /results exceed byte budget/,
      }),
    );
    assert.equal(work.readBytes, 0);
  });
});

test("cold local lookup does not read unrelated history partitions", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 7; sequence += 1)
    await commitFixtureTransaction(
      transactions,
      input(journal, sequence, [put(`m${sequence}`, sequence)]),
    );
  await journal.usingSnapshot(async (snapshot) => {
    await truncate(journalPartitionPath(journal.root, 1), 0);
    const result = await transactions.getMany(query(snapshot, 0, ["m1", "m7"]));
    assert.equal(result.get("m1").value, 1);
    assert.equal(result.get("m7"), null);
  });
});
