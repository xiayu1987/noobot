/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { SessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

test("mutation coordinator distinguishes nested re-entry from concurrent callers", async () =>
  withTemp(async (root) => {
    const coordinator = new SessionMutationCoordinator({ timeoutMs: 2000, pollMs: 2 });
    const lockPath = path.join(root, ".lock");
    const order = [];
    let signalFirstEntered;
    const firstEntered = new Promise((resolve) => {
      signalFirstEntered = resolve;
    });
    const first = coordinator.run(lockPath, async () => {
      order.push("a-start");
      signalFirstEntered();
      await coordinator.run(lockPath, async () => order.push("a-nested"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
    });
    await firstEntered;
    await Promise.all([first, coordinator.run(lockPath, async () => order.push("b"))]);
    assert.deepEqual(order, ["a-start", "a-nested", "a-end", "b"]);
  }));

test("mutation coordinator uses an atomic lock file and removes it after release", async () =>
  withTemp(async (root) => {
    const coordinator = new SessionMutationCoordinator();
    const lockPath = path.join(root, ".lock");
    await coordinator.run(lockPath, async () => {
      assert.equal((await stat(lockPath)).isFile(), true);
      assert.match(await readFile(lockPath, "utf8"), /^\d+:[0-9a-f-]+$/i);
    });
    await assert.rejects(access(lockPath), { code: "ENOENT" });
  }));

test("mutation coordinator replaces stale file and legacy directory locks", async () =>
  withTemp(async (root) => {
    const coordinator = new SessionMutationCoordinator({ staleMs: 10, pollMs: 2 });
    const staleTime = new Date(Date.now() - 1000);
    const fileLock = path.join(root, "file.lock");
    await writeFile(fileLock, "stale-owner", "utf8");
    await utimes(fileLock, staleTime, staleTime);
    await coordinator.run(fileLock, async () => {
      assert.notEqual(await readFile(fileLock, "utf8"), "stale-owner");
    });

    const directoryLock = path.join(root, "directory.lock");
    const legacyOwner = path.join(directoryLock, "owner");
    await mkdir(directoryLock);
    await writeFile(legacyOwner, "legacy-owner", "utf8");
    await utimes(legacyOwner, staleTime, staleTime);
    await coordinator.run(directoryLock, async () => {
      assert.equal((await stat(directoryLock)).isFile(), true);
    });
  }));

test("mutation coordinator heartbeat prevents stale takeover by another coordinator", async () =>
  withTemp(async (root) => {
    const options = { timeoutMs: 3000, staleMs: 1200, pollMs: 10 };
    const firstCoordinator = new SessionMutationCoordinator(options);
    const secondCoordinator = new SessionMutationCoordinator(options);
    const lockPath = path.join(root, "heartbeat.lock");
    const order = [];
    let signalFirstEntered;
    const firstEntered = new Promise((resolve) => {
      signalFirstEntered = resolve;
    });
    const first = firstCoordinator.run(lockPath, async () => {
      order.push("first-start");
      signalFirstEntered();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      order.push("first-end");
    });
    await firstEntered;
    await Promise.all([first, secondCoordinator.run(lockPath, async () => order.push("second"))]);
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
  }));

test("mutation coordinator heartbeat remains ahead of a short stale threshold", async () =>
  withTemp(async (root) => {
    const options = { timeoutMs: 2000, staleMs: 30, pollMs: 2 };
    const firstCoordinator = new SessionMutationCoordinator(options);
    const secondCoordinator = new SessionMutationCoordinator(options);
    const lockPath = path.join(root, "short-heartbeat.lock");
    const order = [];
    let active = 0;
    let overlap = false;
    let signalFirstEntered;
    const firstEntered = new Promise((resolve) => {
      signalFirstEntered = resolve;
    });
    const criticalSection = async (name, holdMs) => {
      active += 1;
      overlap ||= active > 1;
      order.push(`${name}-start`);
      if (name === "first") signalFirstEntered();
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      order.push(`${name}-end`);
      active -= 1;
    };

    const first = firstCoordinator.run(lockPath, () => criticalSection("first", 120));
    await firstEntered;
    await Promise.all([first, secondCoordinator.run(lockPath, () => criticalSection("second", 5))]);

    assert.equal(overlap, false);
    assert.deepEqual(order, ["first-start", "first-end", "second-start", "second-end"]);
  }));

test("mutation coordinator elects one waiter to reclaim a stale lock", async () =>
  withTemp(async (root) => {
    const options = { timeoutMs: 2000, staleMs: 20, pollMs: 1 };
    const lockPath = path.join(root, "contended-stale.lock");
    const staleTime = new Date(Date.now() - 1000);
    await writeFile(lockPath, "999999999:abandoned", "utf8");
    await utimes(lockPath, staleTime, staleTime);

    let active = 0;
    let overlap = false;
    const entries = [];
    const coordinators = Array.from({ length: 3 }, () => new SessionMutationCoordinator(options));
    await Promise.all(
      coordinators.map((coordinator, index) =>
        coordinator.run(lockPath, async () => {
          active += 1;
          overlap ||= active > 1;
          entries.push(index);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
        }),
      ),
    );

    assert.equal(overlap, false);
    assert.equal(new Set(entries).size, 3);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith("contended-stale.lock.wait-")),
      false,
    );
    await assert.rejects(access(lockPath), { code: "ENOENT" });
  }));
