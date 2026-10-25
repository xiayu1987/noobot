/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import { quarantineMigrationUnit } from "../agent/src/workspace-lifecycle/migration-quarantine.js";
import { collectMigrationQuarantine } from "./list-migration-quarantine.mjs";

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
