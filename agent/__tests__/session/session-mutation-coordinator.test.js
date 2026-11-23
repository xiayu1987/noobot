/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { SessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { holdSessionLock } from "../helpers/session-lock-process.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

function coordinator(timeoutMs = 2000) {
  return new SessionMutationCoordinator({ readTiming: () => ({ timeoutMs, pollMs: 2 }) });
}

test("mutation coordinator distinguishes nested re-entry from concurrent callers", async () =>
  withTemp(async (root) => {
    const owner = coordinator();
    const lockPath = path.join(root, ".lock");
    const order = [];
    const firstEntered = Promise.withResolvers();
    const releaseFirst = Promise.withResolvers();
    const first = owner.run(lockPath, async () => {
      order.push("a-start");
      firstEntered.resolve();
      await owner.run(lockPath, async () => order.push("a-nested"));
      await releaseFirst.promise;
      order.push("a-end");
    });
    await firstEntered.promise;
    const second = owner.run(lockPath, async () => order.push("b"));
    releaseFirst.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["a-start", "a-nested", "a-end", "b"]);
  }));

test("work escaping a released lock cannot re-enter a later operation", async () =>
  withTemp(async (root) => {
    const owner = coordinator();
    const lockPath = path.join(root, ".lock");
    const resumeEscaped = Promise.withResolvers();
    const escapedQueued = Promise.withResolvers();
    const order = [];
    function queueEscapedOperation() {
      const operation = owner.run(lockPath, () => order.push("escaped"));
      escapedQueued.resolve();
      return operation;
    }
    let escaped;
    await owner.run(lockPath, async () => {
      escaped = resumeEscaped.promise.then(queueEscapedOperation);
    });
    await owner.run(lockPath, async () => {
      order.push("start");
      resumeEscaped.resolve();
      await escapedQueued.promise;
      order.push("end");
    });
    await escaped;
    assert.deepEqual(order, ["start", "end", "escaped"]);
  }));

test("live process excludes another writer; death releases the same inode", async () =>
  withTemp(async (root) => {
    const lockPath = path.join(root, ".lock");
    const stop = await holdSessionLock(lockPath);
    try {
      const before = await stat(lockPath);
      await assert.rejects(
        coordinator(75).run(lockPath, () => assert.fail("concurrent writer entered")),
        { code: "SESSION_MUTATION_BUSY", statusCode: 409 },
      );
      assert.deepEqual(await stop(), [null, "SIGKILL"]);
      const after = await coordinator().run(lockPath, () => stat(lockPath));
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      assert.deepEqual(await readdir(root), [".lock"]);
    } finally {
      await stop();
    }
  }));

test("failure inside a mutation releases its descriptor", async () =>
  withTemp(async (root) => {
    const lockPath = path.join(root, ".lock");
    const failure = new Error("operation failed");
    await assert.rejects(
      coordinator().run(lockPath, () => {
        throw failure;
      }),
      failure,
    );
    assert.equal(await coordinator().run(lockPath, () => "recovered"), "recovered");
  }));
