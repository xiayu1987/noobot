/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  authorityOutboxJournalPath,
  readAuthorityOutboxRecords,
  withAuthorityOutboxMutation,
} from "../../src/session/authority-outbox-store/outbox-journal.js";

test("authority outbox readers wait for an in-flight journal append", async (t) => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-outbox-read-lock-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(sessionDir, { recursive: true })));
  const file = authorityOutboxJournalPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  const record = { op: "attempt", eventId: "event-1", attemptedAt: "2026-09-17T00:00:00.000Z" };
  const serialized = `${JSON.stringify(record)}\n`;
  const splitAt = Math.floor(serialized.length / 2);
  let releaseWrite;
  const writeReleased = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let partialWritten;
  const partialReady = new Promise((resolve) => {
    partialWritten = resolve;
  });

  const writer = withAuthorityOutboxMutation(sessionDir, async () => {
    const handle = await open(file, "a");
    try {
      await handle.writeFile(serialized.slice(0, splitAt), "utf8");
      partialWritten();
      await writeReleased;
      await handle.writeFile(serialized.slice(splitAt), "utf8");
    } finally {
      await handle.close();
    }
  });

  await partialReady;
  const reader = readAuthorityOutboxRecords(sessionDir);
  releaseWrite();
  assert.deepEqual(await reader, [record]);
  await writer;
});

test("authority outbox readers still reject persisted invalid JSON", async (t) => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-outbox-corrupt-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(sessionDir, { recursive: true })));
  const file = authorityOutboxJournalPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "{broken-json\n", "utf8");

  await assert.rejects(readAuthorityOutboxRecords(sessionDir), {
    code: "ARTIFACT_JSON_CORRUPTED",
  });
});
