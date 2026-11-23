/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat, readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { partitionJournalReservedInodes } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";

async function captureFiles(directory) {
  const captured = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const info = await stat(file, { bigint: true });
    assert.equal(info.isFile(), true);
    captured.push({ name, bytes: await readFile(file), modified: info.mtimeNs, inode: info.ino });
  }
  return captured;
}

test("independent acceptance: sealed partition files remain unchanged through append and reopen", async (context) => {
  const { journal, root, sessionId } = await createJournalCase(context, { partitionRecords: 2 });
  for (let sequence = 1; sequence <= 3; sequence += 1)
    await journal.append(journalRequest(journal, sequence));
  const coldDirectory = path.dirname(journalPartitionPath(root, 0));
  const before = await captureFiles(coldDirectory);
  assert.ok(before.length > 0);
  for (let sequence = 4; sequence <= 40; sequence += 1)
    await journal.append(journalRequest(journal, sequence));
  await journal.close();
  const restored = await PartitionJournal.open({ root, sessionId });
  context.after(() => restored.close());
  const snapshot = await restored.snapshot();
  const page = await restored.readSequencePage({ snapshot, sequence: 1 });
  assert.equal(page.records[0].request.sequence, 1);
  assert.deepEqual(await captureFiles(coldDirectory), before);
});

test("independent acceptance: actual-head inode admission preserves durable state and replay after reopen", async (context) => {
  const { journal: probe } = await createJournalCase(context, { partitionRecords: 1 });
  const quotaInodes = partitionJournalReservedInodes(await probe.snapshot());
  const { journal, root, sessionId } = await createJournalCase(context, {
    partitionRecords: 1,
    quotaInodes,
  });
  const accepted = journalRequest(journal, 1);
  await journal.append(accepted);
  const before = await journal.snapshot();
  const control = await readFile(path.join(root, "CURRENT"));
  const files = (await readdir(root, { recursive: true })).sort();
  await assert.rejects(journal.append(journalRequest(journal, 2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
  await journal.close();
  assert.deepEqual(await readFile(path.join(root, "CURRENT")), control);
  assert.deepEqual((await readdir(root, { recursive: true })).sort(), files);
  const restored = await PartitionJournal.open({ root, sessionId });
  context.after(() => restored.close());
  assert.deepEqual(await restored.snapshot(), before);
  assert.equal((await restored.append(accepted)).replayed, true);
  await assert.rejects(restored.append(journalRequest(restored, 2)), {
    code: "SESSION_STORAGE_QUOTA",
  });
  assert.deepEqual(await restored.snapshot(), before);
});
