/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_ENTITY_DIRECTORY } from "@noobot/session-protocol/partition-entity-directory";
import {
  EMPTY_SEALED_COLLECTION,
  decodePartitionJournalDirectory,
  encodePartitionJournalDirectory,
} from "@noobot/session-protocol/partition-journal";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { entityDirectoryPath } from "../../src/session/partition-storage/entity-directory-io.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

function transaction(journal, sequence) {
  return {
    epoch: journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations: [{ collection: "messages", key: `m${sequence}`, owner: null, value: sequence }],
    result: null,
  };
}

async function lookup(reader, snapshot, partition, key) {
  return (await reader.getMany({ snapshot, partition, collection: "messages", keys: [key] })).get(
    key,
  );
}

test("sealing publishes the final collection root without changing pinned reads", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 4 });
  const writer = new PartitionTransactions(journal);
  const created = await commitFixtureTransaction(writer, transaction(journal, 1));
  await journal.usingSnapshot(async (pinned) => {
    for (const sequence of [2, 3, 4]) {
      await commitFixtureTransaction(writer, {
        ...transaction(journal, sequence),
        mutations: [
          { collection: "messages", key: "m1", owner: created.mutations[0].owner, value: sequence },
        ],
      });
    }
    await writer.projectLatestUpdates();
    const { activeCollection } = journal.head.entityDirectory;
    await commitFixtureTransaction(writer, transaction(journal, 5));
    const seal = decodePartitionJournalDirectory(
      await readFile(journalDirectoryPath(root, 0), "utf8"),
    );
    assert.deepEqual(seal.collectionRoot, activeCollection);
    assert.notDeepEqual(journal.head.entityDirectory.activeCollection, activeCollection);
    assert.equal((await lookup(writer, pinned, 0, "m1")).value, 1);
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  const reader = new PartitionTransactions(reopened);
  try {
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal((await lookup(reader, snapshot, 0, "m1")).value, 4);
    });
  } finally {
    await reopened.close();
  }
});

for (const boundary of [
  "page-write",
  "page-write-zero-progress",
  "page-sync",
  "journal-sync",
  "after-seal",
  "before-current",
  "after-current",
]) {
  test(`collection root and rollover have one outcome after ${boundary} failure`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(
      t,
      { partitionRecords: 2 },
      { autoClose: false },
    );
    const writer = new PartitionTransactions(journal);
    await commitFixtureTransaction(writer, transaction(journal, 1));
    await commitFixtureTransaction(writer, transaction(journal, 2));
    const request = transaction(journal, 3);
    const adapter = getFsAdapter();
    const data = journalPartitionPath(root, 1);
    const directory = path.dirname(data);
    const sealPath = journalDirectoryPath(root, 0);
    let pageSynced = false;
    let dataSynced = false;
    let startRenamed = false;
    let directorySynced = false;
    let injected = false;
    const fail = () => {
      injected = true;
      throw Object.assign(new Error("Injected collection publication failure"), { code: "EIO" });
    };
    setFsAdapter({
      ...adapter,
      async open(file, flags, ...args) {
        const handle = await adapter.open(file, flags, ...args);
        if (file === data && flags === "w+") {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (boundary === "journal-sync") fail();
            await sync();
            dataSynced = true;
          };
        } else if (file.endsWith(".pages") && (flags === "r+" || flags === "w+")) {
          const writev = handle.writev.bind(handle);
          const sync = handle.sync.bind(handle);
          handle.writev = async (buffers, position) => {
            if (boundary === "page-write-zero-progress") {
              injected = true;
              return { bytesWritten: 0 };
            }
            if (boundary === "page-write") {
              await writev([buffers[0].subarray(0, 1)], position);
              fail();
            }
            return writev(buffers, position);
          };
          handle.sync = async () => {
            if (boundary === "page-sync") fail();
            await sync();
            pageSynced = true;
          };
        } else if (file === directory && startRenamed) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            await sync();
            directorySynced = dataSynced;
          };
        }
        return handle;
      },
      async rename(source, target) {
        if (target === sealPath) assert.equal(pageSynced, true);
        if (target === path.join(directory, "START")) {
          if (boundary === "after-seal") {
            const sealed = decodePartitionJournalDirectory(
              await readFile(journalDirectoryPath(root, 0), "utf8"),
            );
            assert.equal(sealed.lastSequence, 2);
            fail();
          }
          await adapter.rename(source, target);
          startRenamed = true;
          return;
        }
        if (String(target) === path.join(root, "CURRENT")) {
          assert.equal(pageSynced, true);
          if (boundary === "before-current") fail();
          await adapter.rename(source, target);
          if (boundary === "after-current") fail();
          return;
        }
        return adapter.rename(source, target);
      },
    });
    try {
      await assert.rejects(commitFixtureTransaction(writer, request), {
        code: "SESSION_COMMIT_UNCERTAIN",
      });
      await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
      assert.equal(injected, true);
      assert.equal(startRenamed, boundary === "before-current" || boundary === "after-current");
      if (process.platform !== "win32") assert.equal(directorySynced, startRenamed);
    } finally {
      setFsAdapter(adapter);
    }
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const reader = new PartitionTransactions(reopened);
    assert.equal((await reopened.snapshot()).sequence, boundary === "after-current" ? 3 : 2);
    await reopened.usingSnapshot(async (snapshot) => {
      assert.equal((await lookup(reader, snapshot, 0, "m2")).value, 2);
    });
    const outcome = await commitFixtureTransaction(reader, request);
    assert.equal(outcome.replayed, boundary === "after-current");
    const snapshot = await reopened.snapshot();
    assert.equal((await lookup(reader, snapshot, 0, "m1")).value, 1);
    assert.equal((await lookup(reader, snapshot, 1, "m3")).value, 3);
    assert.equal(snapshot.sequence, 3);
  });
}

test("a short page vector write resumes inside the next page without changing stored bytes", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {}, { autoClose: false });
  const writer = new PartitionTransactions(journal);
  const adapter = getFsAdapter();
  let shortWrite;
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      const handle = await adapter.open(file, flags, ...args);
      if (!file.endsWith(".pages") || !["w+", "r+"].includes(flags)) return handle;
      const writev = handle.writev.bind(handle);
      let resume = false;
      handle.writev = async (buffers, position) => {
        if (resume) {
          assert.equal(position, shortWrite.offset + shortWrite.written);
          assert.deepEqual(
            Buffer.concat(buffers),
            shortWrite.expected.subarray(shortWrite.written),
          );
          resume = false;
          return writev(buffers, position);
        }
        if (shortWrite || buffers.length < 2) return writev(buffers, position);
        assert.ok(buffers[1].length > 1);
        const first = [buffers[0], buffers[1].subarray(0, 1)];
        const result = await writev(first, position);
        assert.equal(result.bytesWritten, buffers[0].length + 1);
        shortWrite = {
          file,
          offset: position,
          written: result.bytesWritten,
          expected: Buffer.concat(buffers),
        };
        resume = true;
        return result;
      };
      return handle;
    },
  });
  try {
    await commitFixtureTransaction(writer, {
      ...transaction(journal, 1),
      mutations: Array.from({ length: PARTITION_ENTITY_DIRECTORY.maxEntries + 1 }, (_, index) => ({
        collection: "messages",
        key: `m${index + 1}`,
        owner: null,
        value: index + 1,
      })),
    });
  } finally {
    setFsAdapter(adapter);
    await journal.close();
  }
  assert.ok(shortWrite);
  const { file, offset, expected } = shortWrite;
  assert.deepEqual((await readFile(file)).subarray(offset, offset + expected.length), expected);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await reopened.usingSnapshot(async (snapshot) => {
    const reader = new PartitionTransactions(reopened);
    assert.equal((await lookup(reader, snapshot, 0, "m1")).value, 1);
  });
});

test("a mutation-free partition explicitly seals an empty collection", async (t) => {
  const { journal, root } = await createTransactionCase(t, { partitionRecords: 1 });
  const writer = new PartitionTransactions(journal);
  await commitFixtureTransaction(writer, { ...transaction(journal, 1), mutations: [] });
  await commitFixtureTransaction(writer, transaction(journal, 2));
  const seal = decodePartitionJournalDirectory(
    await readFile(journalDirectoryPath(root, 0), "utf8"),
  );
  assert.equal(seal.collectionRoot, EMPTY_SEALED_COLLECTION);
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal(await lookup(writer, snapshot, 0, "m2"), null);
  });
});

for (const corruption of [
  "missing page segment",
  "page checksum",
  "unpublished root",
  "missing root",
]) {
  test(`sealed collection rejects ${corruption} instead of scanning source records`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
    const writer = new PartitionTransactions(journal);
    for (let sequence = 1; sequence <= 3; sequence += 1)
      await commitFixtureTransaction(writer, transaction(journal, sequence));
    const start = journalDirectoryPath(root, 0);
    const seal = decodePartitionJournalDirectory(await readFile(start, "utf8"));
    const { position } = seal.collectionRoot;
    const file = entityDirectoryPath(root, position.segment);
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => assert.rejects(reopened.close(), { code: "SESSION_STORAGE_CORRUPT" }));
    const reader = new PartitionTransactions(reopened);
    const snapshot = await reopened.snapshot();
    if (corruption === "missing page segment") await rm(file);
    else if (corruption === "missing root") {
      await writeFile(start, encodePartitionJournalDirectory({ ...seal, collectionRoot: null }));
    } else if (corruption === "unpublished root") {
      await writeFile(
        start,
        encodePartitionJournalDirectory({
          ...seal,
          collectionRoot: {
            ...seal.collectionRoot,
            position: { ...position, segment: snapshot.entityDirectory.segment + 1 },
          },
        }),
      );
    } else {
      const bytes = await readFile(file);
      bytes[position.offset] ^= 1;
      await writeFile(file, bytes);
    }
    const adapter = getFsAdapter();
    let bodyOpens = 0;
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        if (String(file).endsWith("records.log")) bodyOpens += 1;
        return adapter.open(file, ...args);
      },
    });
    try {
      await assert.rejects(lookup(reader, snapshot, 0, "m1"), {
        code: "SESSION_STORAGE_CORRUPT",
      });
      assert.equal(bodyOpens, 0);
    } finally {
      setFsAdapter(adapter);
    }
  });
}

test("warm rollovers do not open sealed transaction bodies", async (t) => {
  const { journal } = await createTransactionCase(t, { partitionRecords: 2 });
  const writer = new PartitionTransactions(journal);
  await commitFixtureTransaction(writer, transaction(journal, 1));
  await commitFixtureTransaction(writer, transaction(journal, 2));
  const adapter = getFsAdapter();
  const bodyReads = [];
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      if (String(file).endsWith("records.log") && flags === "r") bodyReads.push(file);
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    await Promise.all(
      [3, 4, 5].map((sequence) => commitFixtureTransaction(writer, transaction(journal, sequence))),
    );
    assert.deepEqual(bodyReads, []);
  } finally {
    setFsAdapter(adapter);
  }
  const snapshot = await journal.snapshot();
  assert.equal((await lookup(writer, snapshot, 0, "m1")).value, 1);
  assert.equal((await lookup(writer, snapshot, 1, "m4")).value, 4);
  await journal.releaseSnapshot(snapshot);
});

test("a cold writer extends and seals the active root without reading transaction bodies", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 3 });
  const first = new PartitionTransactions(journal);
  const {
    mutations: [created],
  } = await commitFixtureTransaction(first, transaction(journal, 1));
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const writer = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (oldSnapshot) => {
    const adapter = getFsAdapter();
    const bodyReads = [];
    setFsAdapter({
      ...adapter,
      async open(file, flags, ...args) {
        if (String(file).endsWith("records.log") && flags === "r") bodyReads.push(file);
        return adapter.open(file, flags, ...args);
      },
    });
    try {
      await commitFixtureTransaction(writer, {
        ...transaction(reopened, 2),
        mutations: [{ collection: "messages", key: "m1", owner: created.owner, value: 2 }],
      });
      await commitFixtureTransaction(writer, transaction(reopened, 3));
      assert.deepEqual(bodyReads, []);
      await writer.projectLatestUpdates();
      bodyReads.length = 0;
      await commitFixtureTransaction(writer, transaction(reopened, 4));
      assert.deepEqual(bodyReads, []);
    } finally {
      setFsAdapter(adapter);
    }
    assert.equal((await lookup(writer, oldSnapshot, 0, "m1")).value, 1);
  });
  await reopened.usingSnapshot(async (snapshot) => {
    assert.equal((await lookup(writer, snapshot, 0, "m1")).value, 2);
    assert.equal((await lookup(writer, snapshot, 0, "m3")).value, 3);
    assert.equal((await lookup(writer, snapshot, 1, "m4")).value, 4);
  });
});

test("a non-sealing update after another writer does not open transaction bodies", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 3,
    receiptRecords: 1,
  });
  const first = new PartitionTransactions(journal);
  const {
    mutations: [created],
  } = await commitFixtureTransaction(first, transaction(journal, 1));
  const other = await PartitionJournal.open({ root, sessionId });
  t.after(() => other.close());
  await commitFixtureTransaction(new PartitionTransactions(other), transaction(other, 2));

  const adapter = getFsAdapter();
  let bodyOpens = 0;
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      if (String(file).endsWith("records.log") && flags === "r") bodyOpens += 1;
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    await commitFixtureTransaction(first, {
      ...transaction(journal, 3),
      mutations: [{ collection: "messages", key: "m1", owner: created.owner, value: 3 }],
    });
    assert.equal(bodyOpens, 0);
  } finally {
    setFsAdapter(adapter);
  }

  await first.projectLatestUpdates();
  await commitFixtureTransaction(first, transaction(journal, 4));
  await journal.usingSnapshot(async (snapshot) => {
    assert.equal((await lookup(first, snapshot, 0, "m1")).value, 3);
    assert.equal((await lookup(first, snapshot, 0, "m2")).value, 2);
  });
});

test("a writer rolling over after another writer does not open transaction bodies", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, {
    partitionRecords: 2,
    receiptRecords: 1,
  });
  const first = new PartitionTransactions(journal);
  await commitFixtureTransaction(first, transaction(journal, 1));
  const other = await PartitionJournal.open({ root, sessionId });
  t.after(() => other.close());
  const second = new PartitionTransactions(other);
  await commitFixtureTransaction(second, transaction(other, 2));
  const adapter = getFsAdapter();
  let bodyOpens = 0;
  setFsAdapter({
    ...adapter,
    async open(file, flags, ...args) {
      if (String(file).endsWith("records.log") && flags === "r") bodyOpens += 1;
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    await commitFixtureTransaction(first, transaction(journal, 3));
    assert.equal(bodyOpens, 0);
  } finally {
    setFsAdapter(adapter);
  }
  const snapshot = await journal.snapshot();
  assert.equal((await lookup(first, snapshot, 0, "m1")).value, 1);
  assert.equal((await lookup(first, snapshot, 0, "m2")).value, 2);
  await journal.releaseSnapshot(snapshot);
});

test("independent transaction writers publish all sealed collection roots in a shared group", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 2 });
  const other = await PartitionJournal.open({ root, sessionId });
  t.after(() => other.close());
  const first = new PartitionTransactions(journal);
  const second = new PartitionTransactions(other);
  await Promise.all([
    commitFixtureTransaction(first, transaction(journal, 1)),
    commitFixtureTransaction(first, transaction(journal, 2)),
    commitFixtureTransaction(first, transaction(journal, 3)),
    commitFixtureTransaction(first, transaction(journal, 4)),
    commitFixtureTransaction(first, transaction(journal, 5)),
  ]);
  await commitFixtureTransaction(second, transaction(other, 6));
  await commitFixtureTransaction(second, transaction(other, 7));
  const snapshot = await other.snapshot();
  for (let sequence = 1; sequence <= 7; sequence += 1)
    assert.equal(
      (await lookup(second, snapshot, Math.floor((sequence - 1) / 2), `m${sequence}`)).value,
      sequence,
    );
});

test("reopened journal cannot omit its durable publication protocol", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { partitionRecords: 1 });
  const first = new PartitionTransactions(journal);
  await commitFixtureTransaction(first, transaction(journal, 1));
  const other = await PartitionJournal.open({ root, sessionId });
  t.after(() => other.close());
  const retained = await other.snapshot();
  assert.equal(retained.sequence, 1);
  const before = other.work.writeBytes + other.work.controlWriteBytes;
  const { epoch, sequence } = transaction(other, 2);
  const plainRequest = { epoch, sequence, payload: null };
  await assert.rejects(
    other.appendTransaction(
      { epoch, sequence },
      {
        validateScope: () => assert.fail("Missing participant must fail before scope validation"),
        prepare: () => assert.fail("Missing participant must fail before preparation"),
      },
    ),
    {
      code: "SESSION_PUBLICATION_CONTRACT",
      message: "Required publication participant is not registered",
    },
  );
  assert.equal(other.work.writeBytes + other.work.controlWriteBytes, before);
  assert.equal(other.failure, null);
  const reader = new PartitionTransactions(other);
  await assert.rejects(other.append(plainRequest), { code: "SESSION_PUBLICATION_CONTRACT" });
  assert.equal(other.work.writeBytes + other.work.controlWriteBytes, before);
  await commitFixtureTransaction(reader, transaction(other, 2));
  const latest = await other.snapshot();
  assert.equal((await lookup(reader, latest, 0, "m1")).value, 1);
  await other.releaseSnapshot(latest);
  await other.releaseSnapshot(retained);
});
