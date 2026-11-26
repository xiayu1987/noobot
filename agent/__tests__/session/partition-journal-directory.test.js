/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, readFile, stat, truncate, writeFile } from "node:fs/promises";
import {
  decodePartitionJournalDirectory,
  encodePartitionJournalDirectory,
  PARTITION_JOURNAL_FRAME,
} from "@noobot/session-protocol/partition-journal";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { filePath as path } from "@noobot/path-resolver";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";

async function appendRange(journal, first, last) {
  for (let start = first; start <= last; start += 16)
    await Promise.all(
      Array.from({ length: Math.min(16, last - start + 1) }, (_, offset) => {
        const sequence = start + offset;
        return journal.append(
          journalRequest(journal, sequence, { text: "x".repeat(128), sequence }),
        );
      }),
    );
}

test("sequence lookup crosses byte and record boundaries without scanning earlier partitions", async (t) => {
  for (const limits of [{ partitionRecords: 3 }, { partitionBytes: 4096, partitionRecords: 128 }]) {
    const { journal, root, sessionId } = await createJournalCase(t, limits);
    await appendRange(journal, 1, 257);
    const reader = await PartitionJournal.open({ root, sessionId });
    t.after(() => reader.close());
    await reader.usingSnapshot(async (snapshot) => {
      for (const sequence of [1, 3, 4, 64, 128, 256, 257]) {
        const before = reader.work.readBytes;
        const page = await reader.readSequencePage({ snapshot, sequence });
        assert.equal(page.records[0].request.sequence, sequence);
        assert.equal(page.records[0].request.payload.sequence, sequence);
        const maxDirectoryReads = Math.ceil(Math.log2(snapshot.tail.partition + 2)) + 1;
        assert.ok(
          reader.work.readBytes - before <=
            maxDirectoryReads * PARTITION_JOURNAL_FRAME.directoryBytes +
              snapshot.limits.pageBytes +
              PARTITION_JOURNAL_FRAME.headerBytes +
              PARTITION_JOURNAL_FRAME.offsetBytes,
        );
      }
    });
  }
});

test("sequence lookup respects older snapshot after additional appends and rejects foreign snapshots", async (t) => {
  const { journal } = await createJournalCase(t, { partitionRecords: 3 });
  await appendRange(journal, 1, 5);
  await journal.usingSnapshot(async (snapshot) => {
    await appendRange(journal, 6, 20);
    const before = { ...journal.work };
    const page = await journal.readSequencePage({ snapshot, sequence: 5 });
    assert.equal(
      journal.work.readBytes - before.readBytes,
      page.bytes + PARTITION_JOURNAL_FRAME.offsetBytes,
    );
    assert.equal(journal.work.partitionOpens - before.partitionOpens, 1);
    assert.deepEqual(
      page.records.map(({ request }) => request.sequence),
      [5],
    );
    assert.equal(page.done, true);
    await assert.rejects(journal.readSequencePage({ snapshot, sequence: 6 }), RangeError);
    await assert.rejects(
      journal.readSequencePage({ snapshot: { ...snapshot, epoch: "0".repeat(32) }, sequence: 1 }),
      { code: "SESSION_STORAGE_IDENTITY" },
    );
  });
});

test("active-partition lookup reads only an offset slot and the requested page", async (t) => {
  const { journal } = await createJournalCase(t, { partitionRecords: 3 });
  await appendRange(journal, 1, 257);
  await journal.usingSnapshot(async (snapshot) => {
    for (const sequence of [256, 257]) {
      const before = { ...journal.work };
      const record = await journal.readSequenceRecord({ snapshot, sequence });
      assert.equal(record.request.sequence, sequence);
      assert.equal(
        journal.work.readBytes - before.readBytes,
        record.bytes + PARTITION_JOURNAL_FRAME.offsetBytes,
      );
      assert.equal(journal.work.partitionOpens - before.partitionOpens, 1);
      const beforePage = { ...journal.work };
      const page = await journal.readSequencePage({ snapshot, sequence });
      assert.equal(page.records[0].request.sequence, sequence);
      assert.equal(
        journal.work.readBytes - beforePage.readBytes,
        page.bytes + PARTITION_JOURNAL_FRAME.offsetBytes,
      );
      assert.equal(journal.work.partitionOpens - beforePage.partitionOpens, 1);
    }
  });
});

test("cold sequence pagination reads the selected directory and offset slot once", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { partitionRecords: 2 });
  await appendRange(journal, 1, 18);
  const reader = await PartitionJournal.open({ root, sessionId });
  t.after(() => reader.close());
  const directory = journalDirectoryPath(root, 3);
  const directoryBytes = (await stat(directory)).size;
  await reader.usingSnapshot(async (snapshot) => {
    const { result: page, work } = await observeStorageIo(root, () =>
      reader.readSequencePage({ snapshot, sequence: 8 }),
    );
    assert.deepEqual(
      page.records.map(({ request }) => request.sequence),
      [8, 9, 10, 11, 12, 13, 14, 15],
    );
    assert.equal(work.readBytesByPath.get(path.relative(root, directory)), directoryBytes);
    assert.equal(
      work.readBytesByPath.get(path.relative(root, journalOffsetsPath(root, 3))),
      PARTITION_JOURNAL_FRAME.offsetBytes,
    );
    assert.deepEqual(await reader.readPage({ snapshot, cursor: page.records[0].cursor }), page);
  });
});

test("one batch seals byte-limited partitions with exact bounds and point reads do not open the successor", async (t) => {
  const { journal, root } = await createJournalCase(t, {
    partitionBytes: 4096,
    partitionRecords: 128,
  });
  const publications = journal.work.publications;
  const receipts = await Promise.all(
    [1, 2, 3, 4].map((sequence) =>
      journal.append(journalRequest(journal, sequence, { text: "x".repeat(2400) })),
    ),
  );
  assert.equal(journal.work.publications - publications, 1);
  assert.deepEqual(
    receipts.map(({ reference }) => reference.partition),
    [0, 1, 2, 3],
  );
  for (const partition of [0, 1, 2]) {
    const entry = decodePartitionJournalDirectory(
      await readFile(journalDirectoryPath(root, partition), "utf8"),
    );
    assert.equal(entry.firstSequence, partition + 1);
    assert.equal(entry.lastSequence, partition + 1);
    assert.equal(entry.committedBytes, receipts[partition].end.offset);
  }
  await journal.usingSnapshot(async (snapshot) => {
    const adapter = getFsAdapter();
    const opened = [];
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        opened.push(String(file));
        return adapter.open(file, ...args);
      },
    });
    try {
      const [{ reference }] = receipts;
      assert.equal((await journal.readRecord({ snapshot, reference })).request.sequence, 1);
      assert.deepEqual(
        opened.filter((file) => path.basename(file) === "START"),
        [journalDirectoryPath(root, 0)],
      );
      opened.length = 0;
      await assert.rejects(
        journal.readRecord({ snapshot, reference: { ...reference, sequence: 2 } }),
        {
          name: "RangeError",
          message: "Sequence exceeds partition index bounds",
        },
      );
      assert.deepEqual(opened, []);
    } finally {
      setFsAdapter(adapter);
    }
  });
  await journal.append(journalRequest(journal, 5));
});

test("a checksummed directory with an invalid extent blocks subsequent writes", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 1 },
    { autoClose: false },
  );
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  const { reference } = await journal.append(journalRequest(journal, 1));
  await journal.append(journalRequest(journal, 2));
  const file = journalDirectoryPath(root, 0);
  const entry = decodePartitionJournalDirectory(await readFile(file, "utf8"));
  await writeFile(file, encodePartitionJournalDirectory({ ...entry, lastSequence: 0 }));
  await assert.rejects(
    journal.usingSnapshot((snapshot) => journal.readRecord({ snapshot, reference })),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  await assert.rejects(journal.append(journalRequest(journal, 3)), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});

test("cold sequence lookup stops when a sealed extent contains the record", async (t) => {
  const { journal, root } = await createJournalCase(t, { partitionRecords: 2 });
  await appendRange(journal, 1, 18);
  await journal.usingSnapshot(async (snapshot) => {
    const adapter = getFsAdapter();
    const opened = [];
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        if (path.basename(String(file)) === "START") opened.push(String(file));
        return adapter.open(file, ...args);
      },
    });
    try {
      const record = await journal.readSequenceRecord({ snapshot, sequence: 8 });
      assert.equal(record.request.sequence, 8);
      assert.deepEqual(opened, [journalDirectoryPath(root, 3)]);
    } finally {
      setFsAdapter(adapter);
    }
  });
});

test("corrupt partition directory fails explicitly without a full-history fallback", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 2 },
    { autoClose: false },
  );
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  await appendRange(journal, 1, 6);
  const file = journalDirectoryPath(root, 1);
  const bytes = await readFile(file);
  bytes[10] ^= 1;
  await writeFile(file, bytes);
  await assert.rejects(
    journal.usingSnapshot((snapshot) => journal.readSequencePage({ snapshot, sequence: 3 })),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});

test("partition index corruption rejects rather than returning another valid record", async (t) => {
  const { journal, root } = await createJournalCase(t, {}, { autoClose: false });
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  await appendRange(journal, 1, 4);
  const file = journalOffsetsPath(root, 0);
  const bytes = await readFile(file);
  bytes.writeBigUInt64BE(0n, PARTITION_JOURNAL_FRAME.offsetBytes);
  await writeFile(file, bytes);
  await assert.rejects(
    journal.usingSnapshot((snapshot) => journal.readSequencePage({ snapshot, sequence: 2 })),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});

test("sequence lookup rejects an index pointing at the end of a cold partition", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 2 },
    { autoClose: false },
  );
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  await appendRange(journal, 1, 4);
  const file = journalOffsetsPath(root, 0);
  const bytes = await readFile(file);
  bytes.writeBigUInt64BE(BigInt((await stat(journalPartitionPath(root, 0))).size), 0);
  await writeFile(file, bytes);
  await assert.rejects(
    journal.usingSnapshot((snapshot) => journal.readSequencePage({ snapshot, sequence: 1 })),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
});

test("sealed reads ignore uncommitted bytes and reject a truncated committed record", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 2 },
    { autoClose: false },
  );
  t.after(() => assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  await journal.append(journalRequest(journal, 1));
  const last = await journal.append(journalRequest(journal, 2));
  await journal.append(journalRequest(journal, 3));
  const body = journalPartitionPath(root, 0);
  await appendFile(body, Buffer.from("uncommitted suffix"));
  await journal.usingSnapshot(async (snapshot) => {
    const point = () => journal.readRecord({ snapshot, reference: last.reference });
    const page = () => journal.readSequencePage({ snapshot, sequence: 2 });
    assert.equal((await point()).end.offset, last.end.offset);
    assert.deepEqual(
      (await page()).records.map(({ request }) => request.sequence),
      [2, 3],
    );
    const scoped = await journal.readPartitionPage({ snapshot, cursor: last.cursor });
    assert.deepEqual(
      scoped.records.map(({ request }) => request.sequence),
      [2],
    );
    await truncate(body, last.end.offset - 1);
    await assert.rejects(point, { code: "SESSION_STORAGE_CORRUPT" });
    await assert.rejects(page, { code: "SESSION_STORAGE_CORRUPT" });
  });
});

test("recovery trims unpublished index slots and rejects lost committed slots", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await appendRange(journal, 1, 4);
  const file = journalOffsetsPath(root, 0);
  await appendFile(file, Buffer.alloc(16));
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.equal((await stat(file)).size, 4 * PARTITION_JOURNAL_FRAME.offsetBytes);
  await restored.append(journalRequest(restored, 5));
  await restored.usingSnapshot(async (snapshot) => {
    assert.equal(
      (await restored.readSequencePage({ snapshot, sequence: 5 })).records[0].request.sequence,
      5,
    );
  });
  await truncate(file, 4 * PARTITION_JOURNAL_FRAME.offsetBytes);
  await assert.rejects(PartitionJournal.open({ root, sessionId }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});
