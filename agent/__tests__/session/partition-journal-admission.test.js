/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  createJournalCase,
  journalRequest,
  wrapHandle,
} from "../helpers/partition-journal-cases.js";

test("queue includes in-flight bytes, rejects excess admission, and snapshots caller input", async (t) => {
  const { journal } = await createJournalCase(t, {
    queueBytes: 4096,
    batchBytes: 4096,
    batchRecords: 1,
  });
  const adapter = getFsAdapter();
  let release;
  let entered;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const writing = new Promise((resolve) => {
    entered = resolve;
  });
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (!String(file).endsWith("records.log")) return handle;
      return wrapHandle(handle, {
        async sync() {
          entered();
          await blocked;
          return handle.sync();
        },
      });
    },
  });
  const payload = { delta: "x".repeat(3000) };
  const request = journalRequest(journal, 1, payload);
  const pending = journal.append(request);
  payload.delta = "mutated";
  try {
    await writing;
    await assert.rejects(journal.append(journalRequest(journal, 2, { delta: "x".repeat(3000) })), {
      code: "SESSION_QUEUE_BUDGET",
    });
  } finally {
    release();
    setFsAdapter(adapter);
  }
  const result = await pending;
  const snapshot = await journal.snapshot();
  const page = await journal.readPage({ snapshot, cursor: result.cursor });
  assert.equal(page.records[0].request.payload.delta, "x".repeat(3000));
});
