/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { writeRuntimeEvents, RUNTIME_EVENT_ERROR_CODE } from "../src/index.js";
import { persistSession, tempRoot, readJsonl } from "./runtime-events-test-fixtures.js";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const event = (sessionId, sequence) => ({
  scope: "session",
  userId: "admin",
  sessionId,
  parentSessionId: "",
  source: "agent",
  category: "system",
  event: "batch.test",
  data: { sequence },
});

test("batch validates one session head once, groups writes and revalidates the next batch", async (t) => {
  const root = await tempRoot();
  const sessionDir = await persistSession(root, "admin", {
    sessionId: "batch",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const head = path.join(sessionDir, PARTITION_JOURNAL_HEAD_FILE);
  const originalOpen = fs.open.bind(fs);
  const originalAppend = fs.appendFile.bind(fs);
  let headReads = 0;
  let appends = 0;
  t.mock.method(fs, "open", async (file, ...options) => {
    if (file === head) headReads += 1;
    return originalOpen(file, ...options);
  });
  t.mock.method(fs, "appendFile", async (...args) => {
    appends += 1;
    return originalAppend(...args);
  });
  const results = await writeRuntimeEvents(Array.from({ length: 10 }, (_, i) => event("batch", i)));
  assert.ok(results.every((result) => result.ok));
  assert.equal(headReads, 1);
  assert.equal(appends, 1);
  assert.deepEqual(
    (await readJsonl(results[0].file)).map(({ data }) => data.sequence),
    Array.from({ length: 10 }, (_, i) => i),
  );
  await fs.writeFile(head, "corrupt");
  await assert.rejects(writeRuntimeEvents([event("batch", 10)]), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  assert.equal(headReads, 2);
  assert.equal(appends, 1);
});

test("batch rejects invalid input before writing and bounds record admission", async () => {
  await tempRoot();
  for (const input of [
    [],
    Array.from({ length: QUANTITY_THRESHOLDS.runtimeEvents.batchMaxRecords + 1 }, () =>
      event("s", 0),
    ),
  ])
    await assert.rejects(writeRuntimeEvents(input), TypeError);
  await assert.rejects(
    writeRuntimeEvents([
      { scope: "system", source: "agent", category: "system", event: "valid" },
      { scope: "invalid", source: "agent", event: "invalid" },
    ]),
  );
});

test("missing registration is a positional failure while registered records still commit", async (t) => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "registered",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const warn = t.mock.method(console, "warn", () => {});
  const results = await writeRuntimeEvents([
    event("missing", 0),
    event("registered", 1),
    event("missing", 2),
  ]);
  assert.deepEqual(
    results.map(({ ok }) => ok),
    [false, true, false],
  );
  for (const index of [0, 2]) {
    assert.equal(results[index].error.code, RUNTIME_EVENT_ERROR_CODE.SESSION_NOT_REGISTERED);
    assert.equal(results[index].skipped, undefined);
  }
  assert.equal(warn.mock.callCount(), 2);
  assert.deepEqual(
    (await readJsonl(results[1].file)).map(({ data }) => data.sequence),
    [1],
  );
});

test("batch waits for all files and preserves positional write failures", async (t) => {
  await tempRoot();
  const failure = new Error("batch write failure");
  const originalAppend = fs.appendFile.bind(fs);
  let completed = 0;
  t.mock.method(fs, "appendFile", async (file, ...args) => {
    if (file.endsWith("state.jsonl")) throw failure;
    await originalAppend(file, ...args);
    completed += 1;
  });
  const results = await writeRuntimeEvents(
    ["state", "transport"].map((category) => ({
      scope: "system",
      source: "agent",
      category,
      event: "batch.failure",
    })),
  );
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, failure);
  assert.equal(results[1].ok, true);
  assert.equal(completed, 1);
});
