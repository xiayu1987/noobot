/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_JOURNAL_PUBLICATION_LOCK } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  createJournalCase,
  journalRequest,
  wrapHandle,
} from "../helpers/partition-journal-cases.js";

test("replay cannot acknowledge a visible publication while directory durability fails", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: false });
  const request = journalRequest(journal, 1);
  await journal.append(request);
  const snapshot = await journal.snapshot();
  const adapter = getFsAdapter();
  let attempts = 0;
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (String(file) !== root) return handle;
      return wrapHandle(handle, {
        async sync() {
          attempts += 1;
          throw Object.assign(new Error("Injected replay sync failure"), { code: "EIO" });
        },
      });
    },
  });
  try {
    await assert.rejects(journal.append(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    assert.equal(attempts, 1);
  } finally {
    setFsAdapter(adapter);
  }
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.equal((await restored.append(request)).replayed, true);
  assert.deepEqual(await restored.snapshot(), snapshot);
});

test("append does not acknowledge while lock close blocks, and close failure replays once", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: false });
  const adapter = getFsAdapter();
  const lock = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
  const request = journalRequest(journal, 1);
  const blocked = Promise.withResolvers();
  const closing = Promise.withResolvers();
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (file !== lock) return handle;
      return wrapHandle(handle, {
        async close() {
          closing.resolve();
          await blocked.promise;
          await handle.close();
          throw Object.assign(new Error("Injected lock close failure"), { code: "EIO" });
        },
      });
    },
  });
  const pending = journal.append(request);
  const outcome = pending.then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  try {
    await closing.promise;
    const settled = await Promise.race([
      outcome,
      new Promise((resolve) => setImmediate(resolve, null)),
    ]);
    assert.equal(settled, null);
  } finally {
    blocked.resolve();
    setFsAdapter(adapter);
  }
  await assert.rejects(pending, { code: "SESSION_COMMIT_UNCERTAIN" });
  await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  const snapshot = await restored.snapshot();
  const replay = await restored.append(request);
  assert.equal(replay.replayed, true);
  assert.equal(snapshot.sequence, 1);
  assert.deepEqual(await restored.snapshot(), snapshot);
});
