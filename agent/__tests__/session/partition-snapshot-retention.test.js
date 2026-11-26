/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { decodePartitionJournalControl } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import {
  journalPartitionPath,
  journalRetentionsDirectory,
} from "../../src/session/partition-storage/journal-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createJournalCase,
  createTransactionCase,
  journalRequest,
  listSnapshotRetentionFiles,
} from "../helpers/partition-journal-cases.js";

async function publishedRetentions(journal) {
  const directory = journalRetentionsDirectory(journal.root);
  const files = await listSnapshotRetentionFiles(journal);
  return Promise.all(
    files
      .sort()
      .map(async (file) =>
        decodePartitionJournalControl(await readFile(path.join(directory, file), "utf8")),
      ),
  );
}

const origin = { partition: 0, offset: 0, sequence: 0 };

test("retention slots enforce one cross-instance budget and are reused only after release", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
  const first = await journal.snapshot();
  const before = await readFile(path.join(root, "CURRENT"));
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await assert.rejects(reopened.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  assert.deepEqual(await readFile(path.join(root, "CURRENT")), before);
  const [old] = await publishedRetentions(reopened);
  await reopened.releaseSnapshot(first);
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  const next = await reopened.snapshot();
  const [current] = await publishedRetentions(journal);
  assert.equal(old.slot, current.slot);
  assert.notEqual(old.token, current.token);
  await assert.rejects(journal.readPage({ snapshot: first, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  await assert.rejects(journal.releaseSnapshot(first), { code: "SESSION_SNAPSHOT_RELEASED" });
  assert.equal((await publishedRetentions(journal))[0].token, current.token);
  await journal.releaseSnapshot(next);
});

test("snapshots are immutable capabilities; cloned and raw heads cannot acquire read rights", async (t) => {
  const { journal } = await createJournalCase(t);
  const snapshot = await journal.snapshot();
  assert.throws(() => {
    snapshot.tail.offset = 1;
  }, TypeError);
  for (const forged of [structuredClone(snapshot), structuredClone(journal.head)])
    await assert.rejects(journal.readPage({ snapshot: forged, cursor: origin }), {
      code: "SESSION_SNAPSHOT_RELEASED",
    });
  const page = await journal.readPage({ snapshot, cursor: origin });
  assert.equal(page.done, true);
  await journal.releaseSnapshot(snapshot);
});

test("release waits for reads, permits their nested work and rejects new work", async (t) => {
  const { journal } = await createJournalCase(t);
  const snapshot = await journal.snapshot();
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const reading = journal.withSnapshot(snapshot, async () => {
    started.resolve();
    await resume.promise;
    const page = await journal.readPage({ snapshot, cursor: origin });
    assert.equal(page.done, true);
    await assert.rejects(journal.releaseSnapshot(snapshot), { code: "SESSION_SNAPSHOT_IN_USE" });
  });
  await started.promise;
  const releasing = journal.releaseSnapshot(snapshot);
  await assert.rejects(journal.readPage({ snapshot, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), ["0.json"]);
  resume.resolve();
  await reading;
  await releasing;
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("unawaited nested reads remain protected after the parent returns", async (t) => {
  const { journal } = await createJournalCase(t);
  const snapshot = await journal.snapshot();
  const resume = Promise.withResolvers();
  let nested;
  await journal.withSnapshot(snapshot, () => {
    nested = journal.withSnapshot(snapshot, () => resume.promise);
  });
  const releasing = journal.releaseSnapshot(snapshot);
  assert.deepEqual(await listSnapshotRetentionFiles(journal), ["0.json"]);
  resume.resolve();
  await nested;
  await releasing;
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("old snapshots retain their publication across updates, reopen and writer close", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t);
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(writer, {
    epoch: journal.head.epoch,
    sequence: 1,
    expectedGeneration: 0,
    operationId: `test-operation-${0}`,
    input: { fixtureGeneration: 0 },
    mutations: [{ collection: "messages", key: "m", owner: null, value: "old" }],
    result: null,
  });
  const old = await journal.snapshot();
  await commitFixtureTransaction(writer, {
    epoch: journal.head.epoch,
    sequence: 2,
    expectedGeneration: 1,
    operationId: `test-operation-${1}`,
    input: { fixtureGeneration: 1 },
    mutations: [
      { collection: "messages", key: "m", owner: created.mutations[0].owner, value: "new" },
    ],
    result: null,
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = new PartitionTransactions(reopened);
  const latest = await reopened.snapshot();
  const query = { collection: "messages", keys: ["m"] };
  assert.equal((await reader.getLatestMany({ ...query, snapshot: old })).get("m").value, "old");
  assert.equal((await reader.getLatestMany({ ...query, snapshot: latest })).get("m").value, "new");
  assert.deepEqual(
    (await publishedRetentions(reopened)).map((record) => record.head.sequence),
    [1, 2],
  );
  await reopened.releaseSnapshot(old);
  await reopened.releaseSnapshot(latest);
  await assert.rejects(reader.lookupLatestMany({ ...query, snapshot: old }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
});

test("failed retention deletion leaves reads closed and can be retried", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  const snapshot = await journal.snapshot();
  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async rm(file, ...args) {
      if (String(file) === path.join(root, "retentions", "0.json"))
        throw Object.assign(new Error("Deletion failed"), { code: "EIO" });
      return adapter.rm(file, ...args);
    },
  });
  try {
    await assert.rejects(journal.releaseSnapshot(snapshot), { code: "EIO" });
  } finally {
    setFsAdapter(adapter);
  }
  await assert.rejects(journal.readPage({ snapshot, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  await assert.rejects(journal.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  await journal.releaseSnapshot(snapshot);
  const next = await journal.snapshot();
  await journal.releaseSnapshot(next);
});

test("corrupt retention fails closed without deleting its protected data", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  await journal.append(journalRequest(journal, 1));
  const snapshot = await journal.snapshot();
  const before = await readFile(path.join(root, "CURRENT"));
  await writeFile(path.join(root, "retentions", "0.json"), "broken");
  await assert.rejects(journal.snapshot(), { code: "SESSION_STORAGE_CORRUPT" });
  assert.equal((await journal.readPage({ snapshot, cursor: origin })).records.length, 1);
  await assert.rejects(journal.releaseSnapshot(snapshot), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(await readFile(path.join(root, "CURRENT")), before);
  await assert.rejects(journal.readPage({ snapshot, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
});

test("reopen makes interrupted lease removal durable without touching referenced partitions", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 1,
    retentionRecords: 2,
  });
  const first = journalRequest(journal, 1);
  await journal.append(first);
  const live = await journal.snapshot();
  const closing = await journal.snapshot();
  let released = false;
  try {
    await journal.append(journalRequest(journal, 2));
    const current = path.join(root, "CURRENT");
    const before = await readFile(current);
    const directory = path.join(root, "retentions");
    const adapter = getFsAdapter();
    const failure = Object.assign(new Error("Retention directory sync failed"), { code: "EIO" });
    setFsAdapter({
      ...adapter,
      async syncDirectory(target) {
        if (target === directory) throw failure;
        return adapter.syncDirectory(target);
      },
    });
    try {
      await assert.rejects(journal.releaseSnapshot(closing), (error) => error === failure);
      assert.deepEqual(await readdir(directory), ["0.json"]);
      await assert.rejects(
        PartitionJournal.open({ root, sessionId }),
        (error) => error === failure,
      );
      assert.deepEqual(await readFile(current), before);
    } finally {
      setFsAdapter(adapter);
    }
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    assert.deepEqual(await readFile(current), before);
    const historical = await reopened.readSequencePage({ snapshot: live, sequence: 1 });
    assert.deepEqual(
      historical.records.map(({ request }) => request),
      [first],
    );
    assert.equal((await reopened.append(first)).replayed, true);
    await assert.rejects(reopened.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
    await journal.releaseSnapshot(closing);
    released = true;
    await reopened.usingSnapshot(async (next) => {
      assert.equal(next.sequence, 2);
      assert.deepEqual((await readdir(directory)).sort(), ["0.json", "1.json"]);
    });
  } finally {
    try {
      if (!released) await journal.releaseSnapshot(closing);
    } finally {
      await journal.releaseSnapshot(live);
    }
  }
});

test("the current head still reads sealed history after the last lease and receipt expire", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 1,
    receiptRecords: 1,
  });
  const first = journalRequest(journal, 1);
  const second = journalRequest(journal, 2);
  await journal.append(first);
  await journal.usingSnapshot(async () => {
    await journal.append(second);
  });
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);

  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  for (const locate of [journalDirectoryPath, journalOffsetsPath, journalPartitionPath]) {
    const reader = await PartitionJournal.open({ root, sessionId });
    const file = locate(root, 0);
    const displaced = `${file}.displaced`;
    await rename(file, displaced);
    try {
      const read = reader.usingSnapshot((snapshot) =>
        reader.readSequencePage({ snapshot, sequence: 1 }),
      );
      await assert.rejects(read, (error) => {
        assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
        assert.equal(error.cause?.code, "ENOENT");
        assert.equal(error.cause.path, file);
        return true;
      });
      assert.deepEqual(await readFile(current), before);
    } finally {
      await rename(displaced, file);
    }
    await assert.rejects(reader.close(), { code: "SESSION_STORAGE_CORRUPT" });
  }
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await assert.rejects(reopened.append(first), { code: "SESSION_REQUEST_EXPIRED" });
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal(snapshot.sequence, 2);
    const page = await reopened.readSequencePage({ snapshot, sequence: 1 });
    assert.deepEqual(page.records[0].request, first);
  });
});

test("a retention slot is reusable only after its deletion is durable", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  const old = await journal.snapshot();
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async syncDirectory(directory) {
      if (directory === path.join(root, "retentions") && !injected) {
        injected = true;
        throw Object.assign(new Error("Directory sync failed"), { code: "EIO" });
      }
      return adapter.syncDirectory(directory);
    },
  });
  try {
    await assert.rejects(journal.releaseSnapshot(old), { code: "EIO" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  await assert.rejects(journal.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  await journal.releaseSnapshot(old);
  const next = await journal.snapshot();
  assert.equal((await journal.readPage({ snapshot: next, cursor: origin })).done, true);
  await journal.releaseSnapshot(next);
});
