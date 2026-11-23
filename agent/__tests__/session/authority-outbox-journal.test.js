/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
    const coordinatorUrl = new URL(
      "../../src/session/session-mutation-coordinator.js",
      import.meta.url,
    ).href;
    const record = {
      op: "attempt",
      eventId: "event-process",
      attemptedAt: "2026-10-30T00:00:00.000Z",
    };
    let child;
    let exit;
    await sessionMutationCoordinator.run(
      resolveSessionArtifactMutationLock(sessionDir),
      async () => {
        const file = authorityOutboxJournalPath(sessionDir);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "{partial", "utf8");
        child = spawn(
          process.execPath,
          [
            "--import",
            import.meta.resolve("@noobot/shared/testing/runtime-params"),
            "--input-type=module",
            "-e",
            `
      import { readAuthorityOutboxRecords } from ${JSON.stringify(moduleUrl)};
      import { sessionMutationCoordinator } from ${JSON.stringify(coordinatorUrl)};
      import assert from "node:assert/strict";
      import { once } from "node:events";
      const timing = sessionMutationCoordinator.readTiming;
      sessionMutationCoordinator.readTiming = () => ({ timeoutMs: 100, pollMs: 5 });
      await assert.rejects(readAuthorityOutboxRecords(process.argv[1]), { code: "SESSION_MUTATION_BUSY" });
      sessionMutationCoordinator.readTiming = timing;
      const retry = once(process, "message");
      process.send({ blocked: true });
      await retry;
      process.send(await readAuthorityOutboxRecords(process.argv[1]), () => process.disconnect());
    `,
            sessionDir,
          ],
          { stdio: ["ignore", "ignore", "pipe", "ipc"] },
        );
        t.after(() => child.kill());
        exit = once(child, "exit");
        const [blocked] = await Promise.race([once(child, "message"), exit]);
        assert.deepEqual(blocked, { blocked: true });
        await writeFile(file, `${JSON.stringify(record)}\n`, "utf8");
      },
    );
    const result = once(child, "message");
    child.send({ retry: true });
    const [records] = await Promise.race([result, exit]);
    assert.deepEqual(records, [record]);
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
