/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsPromises, { access, mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import {
  retireDirectoryLockIfPresent,
  retireWorkspaceDirectoryLocks,
} from "../src/workspace-lifecycle/directory-lock-retirement.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { ensureUserWorkspace } from "../src/workspace-lifecycle/index.js";
import { FileMutationCoordinator } from "../src/shared/storage/file-mutation-coordinator.js";
import { withTemp } from "./helpers/temporary-directory.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";

const scopedSessionRoots = ["runtime/agent/session", "runtime/plugin-data/demo/session"];
const retiredPaths = [
  "runtime/session/.lifecycle/locks/session.lock",
  "runtime/session/parent/child.mutation-lock",
  "runtime/session/sessions.json.mutation-lock",
  "runtime/agent/session/child.mutation-lock",
  "runtime/plugin-data/demo/session/child.mutation-lock",
  "runtime/attach/scoped/session/tool/attachments.json.lock",
];

const ABANDONED_OWNER = "abandoned";
const ACTIVE_OWNER = "active";

async function writeOwner(lockPath, owner) {
  const ownerPath = path.join(lockPath, "owner");
  await writeFile(ownerPath, owner);
  if (owner === ACTIVE_OWNER) return;
  const expired = new Date(Date.now() - 120000);
  await utimes(ownerPath, expired, expired);
}

async function oldLock(lockPath, owner = ABANDONED_OWNER) {
  await mkdir(lockPath, { recursive: true });
  await writeOwner(lockPath, owner);
}

async function state(base, version) {
  const file = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version }));
  return file;
}

test("v27 retires all historical lock locations, preserves file locks and is idempotent", async () =>
  withTemp(async (base) => {
    for (const relative of retiredPaths) await oldLock(path.join(base, relative));
    const fileLock = path.join(base, "runtime/agent/session/file.mutation-lock");
    await writeFile(fileLock, "file-owner");
    const result = await retireWorkspaceDirectoryLocks({ base, scopedSessionRoots });
    assert.deepEqual(new Set(result.retired), new Set(retiredPaths.map((p) => path.join(base, p))));
    assert.equal(await readFile(fileLock, "utf8"), "file-owner");
    for (const relative of retiredPaths)
      await assert.rejects(access(path.join(base, relative)), { code: "ENOENT" });
    assert.deepEqual(await retireWorkspaceDirectoryLocks({ base, scopedSessionRoots }), {
      retired: [],
    });
  }));

test("v26 upgrades to v27 only after directory retirement succeeds", async () =>
  withTemp(async (base) => {
    const file = await state(base, 26);
    const lockPath = path.join(base, retiredPaths[0]);
    await oldLock(lockPath, ACTIVE_OWNER);
    const options = {
      base,
      created: false,
      scopedSessionRoots,
      storageService,
      targetStorageBudget: createTestPartitionStorageBudget(),
    };
    await assert.rejects(upgradeWorkspaceLayout(options), { code: "DIRECTORY_LOCK_OWNER_ALIVE" });
    assert.equal(JSON.parse(await readFile(file)).version, 26);
    await writeOwner(lockPath, ABANDONED_OWNER);
    const report = await upgradeWorkspaceLayout(options);
    assert.equal(report[0].id, "directory-lock-retirement-v27");
    assert.deepEqual(report[0].result.retired, [lockPath]);
    assert.equal(JSON.parse(await readFile(file)).version, WORKSPACE_LAYOUT_VERSION);
    assert.deepEqual(await upgradeWorkspaceLayout(options), []);
  }));

test("preflight protects a live legacy owner before any earlier upgrade executes", async () =>
  withTemp(async (base) => {
    const file = await state(base, 1);
    const lockPath = path.join(base, retiredPaths[3]);
    await oldLock(lockPath, ACTIVE_OWNER);
    await assert.rejects(
      upgradeWorkspaceLayout({ base, created: false, scopedSessionRoots, storageService }),
      {
        code: "DIRECTORY_LOCK_OWNER_ALIVE",
      },
    );
    assert.equal(JSON.parse(await readFile(file)).version, 1);
    assert.equal(await readFile(path.join(lockPath, "owner"), "utf8"), ACTIVE_OWNER);
  }));

test("retirement rejects unexpected content and does not traverse symbolic links", async () =>
  withTemp(async (base) => {
    const directory = path.join(base, "unknown.lock");
    await oldLock(directory);
    await writeFile(path.join(directory, "important"), "preserve");
    await assert.rejects(retireDirectoryLockIfPresent(directory), {
      code: "DIRECTORY_LOCK_CONTENT_INVALID",
    });
    assert.equal(await readFile(path.join(directory, "important"), "utf8"), "preserve");
    assert.equal(await readFile(path.join(directory, "owner"), "utf8"), ABANDONED_OWNER);
    const link = path.join(base, "link.lock");
    await symlink(directory, link, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await retireDirectoryLockIfPresent(link), false);
    const file = path.join(base, "not-a-directory");
    await writeFile(file, "preserve");
    await assert.rejects(retireWorkspaceDirectoryLocks({ base: file, scopedSessionRoots }), {
      code: "ENOTDIR",
    });
  }));

test("concurrent directory retirement is safe and the file coordinator works afterwards", async () =>
  withTemp(async (base) => {
    const lockPath = path.join(base, "concurrent.lock");
    await oldLock(lockPath);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => retireDirectoryLockIfPresent(lockPath)),
    );
    assert.equal(results.filter(Boolean).length, 1);
    await new FileMutationCoordinator().run(lockPath, async () => {
      assert.match(
        await readFile(lockPath, "utf8"),
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  }));

test("independent processes elect one directory retirer and remove coordination files", async () =>
  withTemp(async (base) => {
    const lockPath = path.join(base, "process.lock");
    await oldLock(lockPath);
    const moduleUrl = new URL(
      "../src/workspace-lifecycle/directory-lock-retirement.js",
      import.meta.url,
    ).href;
    const runtimeUrl = new URL("../../shared/testing/runtime-params.js", import.meta.url).href;
    const script = `import {retireDirectoryLockIfPresent} from ${JSON.stringify(moduleUrl)}; console.log(await retireDirectoryLockIfPresent(process.argv[1]));`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        promisify(execFile)(process.execPath, [
          "--import",
          runtimeUrl,
          "--input-type=module",
          "-e",
          script,
          lockPath,
        ]),
      ),
    );
    assert.equal(results.filter(({ stdout }) => stdout.trim() === "true").length, 1);
    assert.equal(results.filter(({ stdout }) => stdout.trim() === "false").length, 7);
    assert.deepEqual(await fsPromises.readdir(base), []);
  }));

for (const phase of ["unlink", "rmdir"]) {
  test(`retirement resumes after process death before ${phase} and removes coordination files`, async () =>
    withTemp(async (base) => {
      const lockPath = path.join(base, "interrupted.lock");
      await oldLock(lockPath);
      const moduleUrl = new URL(
        "../src/workspace-lifecycle/directory-lock-retirement.js",
        import.meta.url,
      ).href;
      const runtimeUrl = new URL("../../shared/testing/runtime-params.js", import.meta.url).href;
      const script = `
        import fs from "node:fs/promises";
        import { syncBuiltinESMExports } from "node:module";
        const original = fs[${JSON.stringify(phase)}];
        fs[${JSON.stringify(phase)}] = async (target, ...args) => {
          if (target === ${JSON.stringify(phase === "unlink" ? path.join(lockPath, "owner") : lockPath)}) process.exit(44);
          return original(target, ...args);
        };
        syncBuiltinESMExports();
        const { retireDirectoryLockIfPresent } = await import(${JSON.stringify(moduleUrl)});
        await retireDirectoryLockIfPresent(${JSON.stringify(lockPath)});
      `;
      await assert.rejects(
        promisify(execFile)(process.execPath, [
          "--import",
          runtimeUrl,
          "--input-type=module",
          "-e",
          script,
        ]),
        { code: 44 },
      );
      assert.deepEqual(
        (await fsPromises.readdir(lockPath)).sort(),
        phase === "unlink" ? ["owner"] : [],
      );
      const expired = new Date(Date.now() - 120000);
      await utimes(`${lockPath}.retirement-lock`, expired, expired);
      assert.equal(await retireDirectoryLockIfPresent(lockPath), true);
      assert.deepEqual(await fsPromises.readdir(base), []);
    }));
}

for (const phase of ["unlink", "rmdir"]) {
  test(`retirement reports ${phase} I/O errors and succeeds after the fault is removed`, async (t) =>
    withTemp(async (base) => {
      const lockPath = path.join(base, "io-error.lock");
      await oldLock(lockPath);
      const original = fsPromises[phase];
      const failure = Object.assign(new Error("Injected retirement I/O failure"), { code: "EIO" });
      t.mock.method(fsPromises, phase, async (target, ...args) => {
        if (target === (phase === "unlink" ? path.join(lockPath, "owner") : lockPath))
          throw failure;
        return original(target, ...args);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(retireDirectoryLockIfPresent(lockPath), (error) => error === failure);
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
      assert.equal(await retireDirectoryLockIfPresent(lockPath), true);
      assert.deepEqual(await fsPromises.readdir(base), []);
    }));
}

test("workspace directory lock is retired before ensure obtains its external lock", async () =>
  withTemp(async (root) => {
    const workspaceRoot = path.join(root, "workspace");
    const assetPackagePath = path.join(root, "assets");
    const userId = "user";
    const base = path.join(workspaceRoot, userId);
    const lockPath = path.join(`${workspaceRoot}.mutation-locks`, userId);
    await mkdir(base, { recursive: true });
    await mkdir(assetPackagePath);
    await oldLock(lockPath, ACTIVE_OWNER);
    const options = { workspaceRoot, assetPackagePath, userId };
    await assert.rejects(ensureUserWorkspace(options), { code: "DIRECTORY_LOCK_OWNER_ALIVE" });
    await writeOwner(lockPath, ABANDONED_OWNER);
    assert.equal(await ensureUserWorkspace(options), base);
    await assert.rejects(access(lockPath), { code: "ENOENT" });
  }));

for (const phase of ["readdir", "rmdir"]) {
  test(`retirement preserves a new file lock replacing the directory before ${phase}`, async (t) =>
    withTemp(async (base) => {
      const lockPath = path.join(base, "replaced.lock");
      await oldLock(lockPath);
      const original = fsPromises[phase];
      let replaced = false;
      t.mock.method(fsPromises, phase, async (target, ...args) => {
        if (target === lockPath && !replaced) {
          replaced = true;
          await fsPromises.rm(lockPath, { recursive: true });
          await writeFile(lockPath, "new-file-owner");
        }
        return original(target, ...args);
      });
      syncBuiltinESMExports();
      try {
        assert.equal(await retireDirectoryLockIfPresent(lockPath), false);
        assert.equal(replaced, true);
        assert.equal(await readFile(lockPath, "utf8"), "new-file-owner");
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    }));
}
