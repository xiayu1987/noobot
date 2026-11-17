/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileMutationCoordinator } from "../file-mutation-coordinator.js";

async function fixture(t, overrides) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-mutation-cleanup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lock = path.join(root, "target.lock");
  const Coordinator = createFileMutationCoordinator({ ...fs, ...overrides(lock) });
  const coordinator = new Coordinator({
    readTiming: () => ({ timeoutMs: 2000, staleMs: 60000, pollMs: 2 }),
  });
  return { root, lock, coordinator };
}

test("lock release failure rejects an otherwise successful mutation", async (t) => {
  const failure = new Error("remove lock failed");
  const { lock, coordinator } = await fixture(t, (lock) => ({
    rm: async (file, options) => {
      if (file === lock) throw failure;
      return fs.rm(file, options);
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => "committed"),
    (error) => error === failure,
  );
});

test("mutation and release failures are both preserved", async (t) => {
  const mutationFailure = new Error("mutation failed");
  const releaseFailure = new Error("release failed");
  const { lock, coordinator } = await fixture(t, (lock) => ({
    rm: async (file, options) => {
      if (file === lock) throw releaseFailure;
      return fs.rm(file, options);
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => {
      throw mutationFailure;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, mutationFailure);
      assert.deepEqual(error.errors, [mutationFailure, releaseFailure]);
      return true;
    },
  );
});

test("handle close failure still releases the lock and drains the local queue", async (t) => {
  const failure = new Error("close failed");
  let failClose = true;
  const { root, lock, coordinator } = await fixture(t, (lock) => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      if (file === lock) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (failClose) {
            failClose = false;
            throw failure;
          }
        };
      }
      return handle;
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => "first"),
    (error) => error === failure,
  );
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(await coordinator.run(lock, () => "second"), "second");
});

test("waiter cleanup failure rolls back an acquired lock before invoking the mutation", async (t) => {
  const failure = new Error("waiter close failed");
  const { root, lock, coordinator } = await fixture(t, () => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      if (file.includes(".wait-choosing-")) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          throw failure;
        };
      }
      return handle;
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => assert.fail("mutation must not run")),
    (error) => error === failure,
  );
  assert.deepEqual(await fs.readdir(root), []);
});

test("failed waiter rename preserves the original failure and still removes choosing files", async (t) => {
  const renameFailure = new Error("rename failed");
  const closeFailure = new Error("close failed");
  const { root, lock, coordinator } = await fixture(t, () => ({
    rename: async () => {
      throw renameFailure;
    },
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        throw closeFailure;
      };
      return handle;
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => assert.fail("mutation must not run")),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, renameFailure);
      assert.deepEqual(error.errors, [renameFailure, closeFailure]);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(root), []);
});

test("incomplete owner write and removal failures are not retried as lock contention", async (t) => {
  const writeFailure = new Error("owner write failed");
  const removeFailure = new Error("incomplete lock removal failed");
  const { lock, coordinator } = await fixture(t, (lock) => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      if (file === lock)
        handle.writeFile = async () => {
          throw writeFailure;
        };
      return handle;
    },
    rm: async (file, options) => {
      if (file === lock) throw removeFailure;
      return fs.rm(file, options);
    },
  }));
  await assert.rejects(
    coordinator.run(lock, () => assert.fail("mutation must not run")),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [writeFailure, removeFailure]);
      return true;
    },
  );
});

test("held heartbeat failure is reported and the lock is released", async (t) => {
  const failure = new Error("heartbeat failed");
  const refreshed = Promise.withResolvers();
  const { root, lock, coordinator } = await fixture(t, (lock) => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      if (file === lock)
        handle.utimes = async () => {
          refreshed.resolve();
          throw failure;
        };
      return handle;
    },
  }));
  coordinator.readTiming = () => ({ timeoutMs: 2000, staleMs: 300, pollMs: 2 });
  await assert.rejects(
    coordinator.run(lock, () => refreshed.promise),
    (error) => {
      assert.equal(error.code, "FILE_MUTATION_HEARTBEAT_FAILED");
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(root), []);
});

test("release waits for an in-flight heartbeat before closing its handle", async (t) => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let closeCount = 0;
  const { root, lock, coordinator } = await fixture(t, (lock) => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      if (file === lock) {
        handle.utimes = async () => {
          started.resolve();
          await finish.promise;
        };
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closeCount += 1;
          await close();
        };
      }
      return handle;
    },
  }));
  coordinator.readTiming = () => ({ timeoutMs: 2000, staleMs: 300, pollMs: 2 });
  const result = coordinator.run(lock, () => started.promise);
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCount, 0);
  finish.resolve();
  await result;
  assert.equal(closeCount, 1);
  assert.deepEqual(await fs.readdir(root), []);
});

test("waiter heartbeat failure rejects before entry and preserves the foreign lock", async (t) => {
  const failure = new Error("waiter heartbeat failed");
  const { root, lock, coordinator } = await fixture(t, () => ({
    open: async (file, flags) => {
      const handle = await fs.open(file, flags);
      handle.utimes = async () => {
        throw failure;
      };
      return handle;
    },
  }));
  await fs.writeFile(lock, "foreign-owner");
  coordinator.readTiming = () => ({ timeoutMs: 2000, staleMs: 600, pollMs: 2 });
  await assert.rejects(
    coordinator.run(lock, () => assert.fail("mutation must not run")),
    (error) => {
      assert.equal(error.code, "FILE_MUTATION_HEARTBEAT_FAILED");
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(root), [path.basename(lock)]);
  assert.equal(await fs.readFile(lock, "utf8"), "foreign-owner");
});
