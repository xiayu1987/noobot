/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";

import {
  authorityOutboxJournalPath,
  readAuthorityOutboxRecords,
  withAuthorityOutboxMutation,
} from "../../src/session/authority-outbox-store/outbox-journal.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../../src/session/session-artifact-files.js";

test(
  "outbox readers in another process share the session repair lock",
  { timeout: 10000 },
  async (t) => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-outbox-process-lock-"));
    t.after(() => import("node:fs/promises").then(({ rm }) => rm(sessionDir, { recursive: true })));
    const moduleUrl = new URL(
      "../../src/session/authority-outbox-store/outbox-journal.js",
      import.meta.url,
    ).href;
    const record = {
      op: "attempt",
      eventId: "event-process",
      attemptedAt: "2026-10-30T00:00:00.000Z",
    };
    let result;
    let exit;
    await sessionMutationCoordinator.run(
      resolveSessionArtifactMutationLock(sessionDir),
      async () => {
        const file = authorityOutboxJournalPath(sessionDir);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "{partial", "utf8");
        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
      import { readAuthorityOutboxRecords } from ${JSON.stringify(moduleUrl)};
      process.send(await readAuthorityOutboxRecords(process.argv[1]));
    `,
            sessionDir,
          ],
          { stdio: ["ignore", "ignore", "pipe", "ipc"] },
        );
        t.after(() => child.kill());
        result = once(child, "message");
        exit = once(child, "exit");
        const prefix = `${path.basename(sessionDir)}.mutation-lock.wait-`;
        const deadline = Date.now() + 5000;
        while (!(await readdir(path.dirname(sessionDir))).some((name) => name.startsWith(prefix))) {
          assert.ok(Date.now() < deadline, "child must wait on the session mutation file lock");
          await delay(5);
        }
        await writeFile(file, `${JSON.stringify(record)}\n`, "utf8");
      },
    );
    assert.deepEqual((await result)[0], [record]);
    assert.equal((await exit)[0], 0);
  },
);

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
