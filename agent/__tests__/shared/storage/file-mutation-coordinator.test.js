/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMutationCoordinator } from "../../../src/shared/storage/file-mutation-coordinator.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixedLockTiming(timing) {
  return { readTiming: () => timing };
}

async function lockFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-coordinator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "target.lock");
}

test("nested run inside a held lock reenters without deadlock", async (t) => {
  const lockPath = await lockFixture(t);
  const coordinator = new FileMutationCoordinator(
    fixedLockTiming({ timeoutMs: 2000, staleMs: 60000, pollMs: 10 }),
  );
  const result = await coordinator.run(lockPath, () =>
    coordinator.run(lockPath, async () => "nested"),
  );
  assert.equal(result, "nested");
});

for (const owner of ["", "live-owner"]) {
  test(`fresh lock with ${owner ? "heartbeat" : "unfinished"} owner cannot be reclaimed`, async (t) => {
    const lockPath = await lockFixture(t);
    await writeFile(lockPath, owner);
    const coordinator = new FileMutationCoordinator(
      fixedLockTiming({ timeoutMs: 30, staleMs: 60000, pollMs: 2 }),
    );
    await assert.rejects(
      coordinator.run(lockPath, () => assert.fail("must not enter")),
      {
        code: "FILE_MUTATION_BUSY",
      },
    );
    assert.equal(await readFile(lockPath, "utf8"), owner);
  });
}

test("stale heartbeat lock is reclaimed even when its owner names a live process id", async (t) => {
  const lockPath = await lockFixture(t);
  await writeFile(lockPath, `${process.pid}:reused-pid-owner`);
  const expired = new Date(Date.now() - 120000);
  await utimes(lockPath, expired, expired);
  const coordinator = new FileMutationCoordinator(
    fixedLockTiming({ timeoutMs: 2000, staleMs: 60000, pollMs: 2 }),
  );
  assert.equal(await coordinator.run(lockPath, async () => "entered"), "entered");
});

test("held lock with a refreshing heartbeat is not reclaimed by a contender", async (t) => {
  const lockPath = await lockFixture(t);
  const coordinator = new FileMutationCoordinator(
    fixedLockTiming({ timeoutMs: 2000, staleMs: 300, pollMs: 10 }),
  );
  let contenderEntered = false;
  await coordinator.run(lockPath, async () => {
    const contender = new FileMutationCoordinator(
      fixedLockTiming({ timeoutMs: 900, staleMs: 300, pollMs: 10 }),
    );
    await assert.rejects(
      contender.run(lockPath, async () => {
        contenderEntered = true;
      }),
      { code: "FILE_MUTATION_BUSY" },
    );
  });
  assert.equal(contenderEntered, false);
});

test("continuations spawned inside a lock must reacquire it after release", async (t) => {
  const lockPath = await lockFixture(t);
  const coordinator = new FileMutationCoordinator(
    fixedLockTiming({ timeoutMs: 5000, staleMs: 60000, pollMs: 10 }),
  );
  let active = 0;
  let peak = 0;
  const guarded = () =>
    coordinator.run(lockPath, async () => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await sleep(20);
      } finally {
        active -= 1;
      }
    });
  let spawned;
  await coordinator.run(lockPath, async () => {
    spawned = sleep(30).then(() => Promise.all(Array.from({ length: 4 }, guarded)));
  });
  await spawned;
  assert.equal(peak, 1, "stale async context must not bypass the file lock");
});
