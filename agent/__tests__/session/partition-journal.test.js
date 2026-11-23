/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, open, readFile, stat, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";

test("group commit publishes distinct transactions once and preserves an old snapshot", async (t) => {
  const { journal } = await createJournalCase(t);
  const before = await journal.snapshot();
  const results = await Promise.all(
    [1, 2, 3].map((seq) => journal.append(journalRequest(journal, seq))),
  );
  assert.deepEqual(
    results.map((result) => result.sequence),
    [1, 2, 3],
  );
  assert.equal(journal.work.dataSyncs, 1);
  assert.equal(journal.work.publications, 2);
  assert.equal(before.sequence, 0);
  const snapshot = await journal.snapshot();
  const page = await journal.readPage({ snapshot, cursor: results[0].cursor });
  assert.equal(page.done, true);
  assert.deepEqual(
    page.records.map((record) => record.request.sequence),
    [1, 2, 3],
  );
  assert.equal(
    (await journal.readPage({ snapshot: before, cursor: before.tail })).records.length,
    0,
  );
});

test("zero wait batches queued appends without waiting for a timer", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { batchWaitMs: 0 });
  const before = journal.work.publications;
  const pending = [1, 2, 3].map((seq) => journal.append(journalRequest(journal, seq)));
  assert.ok(journal.running);
  assert.equal(journal.timer, null);
  const results = await Promise.all(pending);
  assert.deepEqual(
    results.map(({ sequence }) => sequence),
    [1, 2, 3],
  );
  assert.equal(journal.work.publications - before, 1);
  assert.equal(journal.work.dataSyncs, 1);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.limits.batchWaitMs, 0);
  assert.equal((await reopened.append(journalRequest(journal, 2))).replayed, true);
});

test("replay and expiry use the advancing retry window across publications", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { receiptRecords: 1 });
  const first = journalRequest(journal, 1);
  const second = journalRequest(journal, 2);
  const [accepted, replayed, next, expired] = await Promise.allSettled(
    [first, first, second, first].map((request) => journal.append(request)),
  );
  assert.equal(accepted.value.replayed, false);
  assert.equal(replayed.value.replayed, true);
  assert.deepEqual(replayed.value.reference, accepted.value.reference);
  assert.deepEqual(replayed.value.payload, accepted.value.payload);
  assert.notEqual(replayed.value.payload, accepted.value.payload);
  next.value.payload.delta = "changed by caller";
  assert.deepEqual((await journal.append(second)).payload, second.payload);
  assert.equal(next.value.sequence, 2);
  assert.equal(expired.reason.code, "SESSION_REQUEST_EXPIRED");
  assert.equal(journal.work.publications, 3);

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await assert.rejects(reopened.append(first), { code: "SESSION_REQUEST_EXPIRED" });
  assert.deepEqual((await reopened.append(second)).reference, next.value.reference);
});

test("rolls on bytes or record count, paginates and recovers a bounded retry window", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 3,
    pageRecords: 2,
    receiptRecords: 4,
  });
  for (let seq = 1; seq <= 20; seq += 1) await journal.append(journalRequest(journal, seq));
  const snapshot = await journal.snapshot();
  assert.equal(snapshot.tail.partition, 6);
  let cursor = { partition: 0, offset: 0, sequence: 0 };
  const seen = [];
  while (cursor.sequence < snapshot.sequence) {
    const page = await journal.readPage({ snapshot, cursor });
    assert.ok(page.records.length <= 2);
    seen.push(...page.records.map((record) => record.request.sequence));
    cursor = page.next;
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.equal((await restored.append(journalRequest(restored, 20))).replayed, true);
  assert.equal(restored.receipts.length, 4);
  assert.ok(restored.work.readBytes < 16 * 1024);
  await assert.rejects(restored.append(journalRequest(restored, 1)), {
    code: "SESSION_REQUEST_EXPIRED",
  });
  await assert.rejects(restored.append(journalRequest(restored, 20, { delta: "changed" })), {
    code: "SESSION_OPERATION_CONFLICT",
  });
  await assert.rejects(
    restored.append({ ...journalRequest(restored, 21), epoch: "0".repeat(32) }),
    { code: "SESSION_REQUEST_EPOCH" },
  );
  await restored.append(journalRequest(restored, 21));
});

test("rejects non-JSON data, oversized transactions, gaps and quota exhaustion explicitly", async (t) => {
  const { journal } = await createJournalCase(t, { quotaPartitions: 1, partitionRecords: 1 });
  await assert.rejects(journal.append(journalRequest(journal, 1, { value: undefined })), TypeError);
  await assert.rejects(journal.append(journalRequest(journal, 1, { delta: "x".repeat(5000) })), {
    code: "SESSION_TRANSACTION_BUDGET",
  });
  await assert.rejects(journal.append(journalRequest(journal, 2)), {
    code: "SESSION_GENERATION_CONFLICT",
  });
  await journal.append(journalRequest(journal, 1));
  await assert.rejects(journal.append(journalRequest(journal, 2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
  assert.equal((await journal.snapshot()).sequence, 1);
});

test("unpublished suffix is discarded while committed damage fails loudly", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  const snapshot = await journal.snapshot();
  const file = journalPartitionPath(root, 0);
  await appendFile(file, "incomplete uncommitted frame");
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => assert.rejects(restored.close(), { code: "SESSION_STORAGE_CORRUPT" }));
  assert.equal((await stat(file)).size, snapshot.tail.offset);
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const handle = await open(file, "r+");
  try {
    await handle.write(Buffer.from("!"), 0, 1, 70);
  } finally {
    await handle.close();
  }
  await assert.rejects(
    restored.readPage({ snapshot, cursor: { partition: 0, offset: 0, sequence: 0 } }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  await assert.rejects(restored.append(journalRequest(restored, 2)), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.deepEqual(await readFile(current), before);
  assert.equal((await stat(file)).size, snapshot.tail.offset);
});

test("independent instances serialize writes and refresh only bounded receipts", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  const other = await PartitionJournal.open({ root, sessionId });
  t.after(() => other.close());
  await journal.append(journalRequest(journal, 1));
  await other.append(journalRequest(other, 2));
  assert.equal((await journal.append(journalRequest(journal, 2))).replayed, true);
  await journal.append(journalRequest(journal, 3));
  assert.equal((await other.snapshot()).sequence, 3);
});

test("unacknowledged publication can be retried after reopening without duplicate append", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  const request = journalRequest(journal, 1);
  await journal.append(request);
  const before = await journal.snapshot();
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.equal((await restored.append(request)).replayed, true);
  assert.deepEqual(await restored.snapshot(), before);
  const control = path.join(root, "CURRENT");
  const envelope = JSON.parse(await readFile(control, "utf8"));
  envelope.digest = "0".repeat(64);
  await writeFile(control, JSON.stringify(envelope));
  await assert.rejects(PartitionJournal.open({ root, sessionId }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});
