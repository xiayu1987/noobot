/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { FileMutationCoordinator } from "../../../src/shared/storage/file-mutation-coordinator.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-local-mutation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coordinator = new FileMutationCoordinator({
    readTiming: () => ({ timeoutMs: 1000, staleMs: 60000, pollMs: 100 }),
  });
  return { coordinator, root, lock: path.join(root, "session.lock") };
}

test("local contenders enter file-lock election one at a time and release in FIFO order", async (t) => {
  const { coordinator, root, lock } = await fixture(t);
  const acquired = t.mock.method(coordinator, "acquireAsWaiter");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const order = [];
  const first = coordinator.run(lock, async () => {
    entered.resolve();
    await release.promise;
    order.push(0);
  });
  await entered.promise;
  const following = [1, 2, 3].map((index) => coordinator.run(lock, () => order.push(index)));
  await setImmediate();
  assert.equal(acquired.mock.callCount(), 1);
  assert.deepEqual(await readdir(root), ["session.lock"]);
  release.resolve();
  await Promise.all([first, ...following]);
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.equal(acquired.mock.callCount(), 4);
  assert.deepEqual(await readdir(root), []);
  assert.equal(await coordinator.run(lock, () => "reacquired"), "reacquired");
});

test("an expired local waiter cannot run later or release the queue ahead of its owner", async (t) => {
  const { coordinator, lock } = await fixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const first = coordinator.run(lock, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  coordinator.readTiming = () => ({ timeoutMs: 20, staleMs: 60000, pollMs: 100 });
  await assert.rejects(
    coordinator.run(lock, () => assert.fail("expired waiter ran")),
    {
      code: "FILE_MUTATION_BUSY",
    },
  );
  coordinator.readTiming = () => ({ timeoutMs: 1000, staleMs: 60000, pollMs: 100 });
  let thirdEntered = false;
  const third = coordinator.run(lock, () => {
    thirdEntered = true;
  });
  await setImmediate();
  assert.equal(thirdEntered, false);
  release.resolve();
  await Promise.all([first, third]);
  assert.equal(thirdEntered, true);
  assert.equal(await coordinator.run(lock, () => "reacquired"), "reacquired");
});

test("failed mutations release local waiters and independent paths do not block each other", async (t) => {
  const { coordinator, root, lock } = await fixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const failure = new Error("write failed");
  const first = coordinator.run(lock, async () => {
    entered.resolve();
    await release.promise;
    throw failure;
  });
  const rejected = assert.rejects(first, (error) => error === failure);
  await entered.promise;
  const next = coordinator.run(lock, () => "next");
  assert.equal(
    await coordinator.run(path.join(root, "other.lock"), () => "independent"),
    "independent",
  );
  release.resolve();
  await rejected;
  assert.equal(await next, "next");
  assert.equal(await coordinator.run(lock, () => "reacquired"), "reacquired");
});
