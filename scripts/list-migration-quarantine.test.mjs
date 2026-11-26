/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import {
  quarantineMigrationUnit,
  restoreQuarantinedUnits,
} from "../agent/src/workspace-lifecycle/migration-quarantine.js";
import { collectMigrationQuarantine } from "./list-migration-quarantine.mjs";
import { retireUnsupportedSessionStorage } from "../agent/src/workspace-lifecycle/session-storage-retirement.js";

async function snapshotTree(root) {
  const entries = await readdir(root, { recursive: true });
  return entries.sort();
}

test("quarantine listing reports held units and backups without touching files", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-quarantine-list-"));
  try {
    const base = path.join(workspaceRoot, "admin");
    const movedSession = "runtime/session/s-moved/session.json";
    await mkdir(path.join(base, path.dirname(movedSession)), { recursive: true });
    await writeFile(path.join(base, movedSession), "{}\n");
    await mkdir(path.join(base, "runtime/workspace-backups/2026-10-25T00-00-00-000Z"), {
      recursive: true,
    });
    await mkdir(path.join(workspaceRoot, "clean-user"), { recursive: true });
    const usersFile = path.join(workspaceRoot, WORKSPACE_ROOT_LAYOUT.USERS_FILE);
    await mkdir(path.dirname(usersFile), { recursive: true });
    await writeFile(
      usersFile,
      JSON.stringify({ users: [{ userId: "clean-user" }, { userId: "missing-user" }] }),
    );
    const strayBase = path.join(workspaceRoot, "system");
    await quarantineMigrationUnit({
      base: strayBase,
      kind: "sessionLifecycle",
      relativePath: "runtime/session/not-a-user",
      error: new Error("stray"),
    });
    const error = Object.assign(new Error("tombstone lacks requestHash"), {
      code: "SESSION_TURN_REPLACEMENT_TOMBSTONE_INVALID",
    });
    await quarantineMigrationUnit({
      base,
      kind: "sessionMessageIdentity",
      relativePath: movedSession,
      error,
      move: true,
    });
    await quarantineMigrationUnit({
      base,
      kind: "sessionLifecycle",
      relativePath: "runtime/session/s-kept",
      error,
    });
    const before = await snapshotTree(workspaceRoot);

    const users = await collectMigrationQuarantine(workspaceRoot, {
      superAdmin: { userId: "admin" },
    });

    assert.deepEqual(await snapshotTree(workspaceRoot), before);
    assert.deepEqual(
      users.map((user) => user.userId),
      ["admin"],
    );
    const [{ units, backups }] = users;
    assert.deepEqual(backups, ["runtime/workspace-backups/2026-10-25T00-00-00-000Z"]);
    assert.deepEqual(
      units.map(({ kind, path: unitPath, moved, quarantinePath, error: unitError }) => ({
        kind,
        unitPath,
        moved,
        quarantinePath,
        code: unitError.code,
      })),
      [
        {
          kind: "sessionLifecycle",
          unitPath: "runtime/session/s-kept",
          moved: false,
          quarantinePath:
            "runtime/migration-quarantine/sessionLifecycle/runtime/session/s-kept.reason.json",
          code: "SESSION_TURN_REPLACEMENT_TOMBSTONE_INVALID",
        },
        {
          kind: "sessionMessageIdentity",
          unitPath: movedSession,
          moved: true,
          quarantinePath: `runtime/migration-quarantine/sessionMessageIdentity/${movedSession}`,
          code: "SESSION_TURN_REPLACEMENT_TOMBSTONE_INVALID",
        },
      ],
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("quarantine report retains format, terminal status and source location across reads", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-retirement-report-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const base = path.join(workspaceRoot, "admin");
  const source = path.join(base, "runtime/session/old");
  await mkdir(path.join(source, "child"), { recursive: true });
  await writeFile(path.join(source, "head.json"), "old immutable bytes");
  await writeFile(path.join(source, "child/CURRENT"), "partition bytes");
  await retireUnsupportedSessionStorage({ base, scopedSessionRoots: [] });
  const config = { superAdmin: { userId: "admin" } };
  const before = await snapshotTree(workspaceRoot);
  const report = await collectMigrationQuarantine(workspaceRoot, config);
  assert.deepEqual(await collectMigrationQuarantine(workspaceRoot, config), report);
  assert.deepEqual(await snapshotTree(workspaceRoot), before);
  const [{ units }] = report;
  assert.equal(units.length, 2);
  const old = units.find(({ sessionStorage }) => sessionStorage.format === "immutable");
  assert.deepEqual(old.sessionStorage, { format: "immutable", status: "unsupported-format" });
  assert.equal(old.path, "runtime/session/old");
  assert.equal(old.error.code, "SESSION_STORAGE_FORMAT_UNSUPPORTED");
  assert.equal(old.moved, true);
  assert.ok(Number.isFinite(Date.parse(old.quarantinedAt)));
  assert.equal(
    await readFile(path.join(base, old.quarantinePath, "head.json"), "utf8"),
    "old immutable bytes",
  );
  const child = units.find(({ sessionStorage }) => sessionStorage.format === "partition");
  assert.deepEqual(child.sessionStorage, {
    format: "partition",
    status: "parent-unavailable",
    parentPath: old.path,
  });
  assert.equal(child.error.code, "SESSION_PARENT_UNAVAILABLE");
  assert.equal(
    await readFile(path.join(base, child.quarantinePath, "CURRENT"), "utf8"),
    "partition bytes",
  );
});

test("a stored Windows receipt resolves its original object and restores without moving the receipt", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "noobot-quarantine-restore-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const relativePath = "runtime/session/old";
  const original = path.join(base, relativePath);
  await mkdir(path.dirname(original), { recursive: true });
  await writeFile(original, "original bytes");
  const kind = "sessionLifecycle";
  const receipt = await quarantineMigrationUnit({
    base,
    kind,
    relativePath: relativePath.replaceAll("/", "\\"),
    error: new Error("migration failed"),
    move: true,
  });
  const file = `${path.join(base, receipt.quarantinePath)}.reason.json`;
  const record = JSON.parse(await readFile(file, "utf8"));
  assert.equal(record.path, relativePath);
  await writeFile(file, JSON.stringify({ ...record, path: relativePath.replaceAll("/", "\\") }));

  await restoreQuarantinedUnits({ base, kind, released: [] });
  assert.equal(await readFile(original, "utf8"), "original bytes");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { ...record, restored: true });
});
