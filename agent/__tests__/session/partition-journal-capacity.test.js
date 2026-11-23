/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  encodePartitionJournalControl,
  partitionJournalReservedBytes,
  partitionJournalReservedInodes,
  requirePartitionJournalHead,
  requirePartitionSessionStorageBudget,
} from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  createJournalCase,
  journalRequest,
  journalTestLimits,
} from "../helpers/partition-journal-cases.js";

test("inode admission reserves publication and maintenance capacity before creating another partition", async (t) => {
  const limits = journalTestLimits({ partitionRecords: 1 });
  limits.quotaInodes = partitionJournalReservedInodes({
    tail: { partition: 0 },
    entityDirectory: { segment: 0 },
    limits,
  });
  const { journal, root, sessionId } = await createJournalCase(t, limits);
  await journal.append(journalRequest(journal, 1));
  await journal.startDrain();
  const head = await journal.snapshot();
  const control = await readFile(path.join(root, "CURRENT"));
  const before = await readdir(root, { recursive: true });
  const written = journal.work.writeBytes;
  await assert.rejects(journal.append(journalRequest(journal, 2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
  await journal.startDrain();
  assert.deepEqual(await readFile(path.join(root, "CURRENT")), control);
  assert.deepEqual(await readdir(root, { recursive: true }), before);
  assert.equal(journal.work.writeBytes, written);
  assert.equal(journal.failure, null);
  assert.equal((await journal.append(journalRequest(journal, 1))).replayed, true);
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.deepEqual(await restored.snapshot(), head);
  await assert.rejects(restored.append(journalRequest(restored, 2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
});

test("an inode rejection in a group cannot advance the rejected sequence or prevent a valid replay", async (t) => {
  const limits = journalTestLimits({ partitionRecords: 1 });
  limits.quotaInodes = partitionJournalReservedInodes({
    tail: { partition: 0 },
    entityDirectory: { segment: 0 },
    limits,
  });
  const { journal } = await createJournalCase(t, limits);
  const results = await Promise.allSettled([
    journal.append(journalRequest(journal, 1)),
    journal.append(journalRequest(journal, 2)),
    journal.append(journalRequest(journal, 1)),
  ]);
  await journal.startDrain();
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].reason.code, "SESSION_STORAGE_QUOTA");
  assert.equal(results[2].value.replayed, true);
  assert.equal((await journal.snapshot()).sequence, 1);
  assert.equal(journal.queuedBytes, 0);
});

for (const [quota, reserved] of [
  ["quotaInodes", partitionJournalReservedInodes],
  ["quotaBytes", partitionJournalReservedBytes],
]) {
  test(`configuration and creation agree at the ${quota} boundary`, async (t) => {
    const { journal, root } = await createJournalCase(t);
    const empty = await journal.snapshot();
    const { publication, limits } = empty;
    const required = reserved(empty);
    const insufficient = { ...limits, [quota]: required - 1 };
    assert.throws(
      () => requirePartitionSessionStorageBudget({ journalLimits: insufficient, maxJournals: 1 }),
      /Inconsistent partition journal budgets/,
    );
    const target = path.join(root, "missing-parent", "invalid");
    const before = await readdir(root);
    await assert.rejects(
      PartitionJournal.create({
        root: target,
        durableAncestor: root,
        sessionId: "invalid",
        limits: insufficient,
        publication,
      }),
      TypeError,
    );
    assert.deepEqual(await readdir(root), before);
    const { journalLimits } = requirePartitionSessionStorageBudget({
      journalLimits: { ...limits, [quota]: required },
      maxJournals: 1,
    });
    const created = await PartitionJournal.create({
      root: target,
      durableAncestor: root,
      sessionId: "invalid",
      limits: journalLimits,
      publication,
    });
    t.after(() => created.close());
    assert.equal((await created.snapshot()).sequence, 0);
  });
}

test("impossible publication extents are rejected at the protocol boundary", async (t) => {
  const { journal } = await createJournalCase(t, { partitionRecords: 2 });
  const empty = await journal.snapshot();
  for (const change of [
    { tail: { ...empty.tail, offset: 1 }, dataBytes: 1 },
    { tail: { ...empty.tail, partition: 1 } },
    { dataBytes: 1 },
    { receiptStart: { partition: 0, offset: 0, sequence: 1 } },
  ])
    assert.throws(() => requirePartitionJournalHead({ ...empty, ...change }), TypeError);
  for (let sequence = 1; sequence <= 5; sequence += 1)
    await journal.append(journalRequest(journal, sequence));
  const head = await journal.snapshot();
  for (const change of [
    { partitionRecords: 0 },
    { tail: { ...head.tail, offset: 1 } },
    { tail: { ...head.tail, partition: head.sequence } },
    { dataBytes: head.tail.offset },
    { dataBytes: head.limits.transactionBytes * (head.sequence + 1) },
    { receiptStart: { partition: 0, offset: head.limits.partitionBytes, sequence: 0 } },
    { receiptStart: { partition: head.tail.partition, offset: 0, sequence: 0 } },
  ])
    assert.throws(() => requirePartitionJournalHead({ ...head, ...change }), TypeError);
});

test("a checksummed but impossible head fails before recovery deletes any files", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  await journal.close();
  const head = await journal.snapshot();
  const before = await readdir(path.join(root, "partitions"), { recursive: true });
  const corrupt = {
    ...head,
    sequence: 0,
    tail: { ...head.tail, sequence: 0 },
    partitionRecords: 0,
  };
  await writeFile(path.join(root, "CURRENT"), encodePartitionJournalControl(corrupt));
  await assert.rejects(PartitionJournal.open({ root, sessionId }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.deepEqual(await readdir(path.join(root, "partitions"), { recursive: true }), before);
});
