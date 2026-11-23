/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { releaseQuarantinedUnits } from "./helpers/user-workspace.js";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import {
  partitionMigrationAuthorityPath,
  partitionMigrationRoot,
  readPartitionStorageRoot,
} from "../src/session/session-storage-authority.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { acquireWorkspaceStorageLock } from "../src/workspace-lifecycle/workspace-storage-lock.js";
import { upgradeSessionPartitionStorage } from "../src/workspace-lifecycle/migrate-workspace-sessions-to-partition.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import { getFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { quarantineMigrationUnit } from "../src/workspace-lifecycle/migration-quarantine.js";
import { journalTestLimits } from "./helpers/partition-journal-cases.js";
import { migratedWorkspace } from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

for (const window of ["before-quarantine-rename", "after-release-rename"]) {
  test(`quarantine movement resumes with the original identity after ${window}`, async (t) => {
    const { base } = await migratedWorkspace(t);
    const kind = "source-upgrade";
    const relativePath = join(WORKSPACE_LAYOUT.SESSION_DIR, "unidentified-source");
    const original = join(base, relativePath);
    const held = join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR, kind, relativePath);
    await writeFile(original, "source evidence");
    const quarantine = () =>
      quarantineMigrationUnit({
        base,
        kind,
        relativePath,
        error: new Error("Unidentified source"),
        move: true,
      });
    const release = () => releaseQuarantinedUnits({ base, kind });
    const adapter = getFsAdapter();
    const rename = adapter.rename.bind(adapter);
    const interrupted = new Error("quarantine migration interrupted");
    const fault = t.mock.method(adapter, "rename", async (from, to) => {
      if (window === "before-quarantine-rename" && to === held) throw interrupted;
      await rename(from, to);
      if (window === "after-release-rename" && to === original) throw interrupted;
    });
    try {
      if (window === "before-quarantine-rename") {
        await assert.rejects(quarantine(), interrupted);
        await assert.rejects(stat(held), { code: "ENOENT" });
      } else {
        await quarantine();
        await assert.rejects(release(), interrupted);
      }
      assert.equal(await readFile(original, "utf8"), "source evidence");
      assert.equal(JSON.parse(await readFile(`${held}.reason.json`, "utf8")).moved, true);
    } finally {
      fault.mock.restore();
    }
    assert.deepEqual(await release(), [relativePath]);
    assert.equal(await readFile(original, "utf8"), "source evidence");
    await assert.rejects(stat(`${held}.reason.json`), { code: "ENOENT" });
  });
}

for (const field of ["moveIdentity", "moved"]) {
  test(`quarantine recovery rejects a receipt missing ${field} without deriving ownership`, async (t) => {
    const { base } = await migratedWorkspace(t);
    const kind = "source-upgrade";
    const relativePath = join(WORKSPACE_LAYOUT.SESSION_DIR, "unidentified-source");
    const original = join(base, relativePath);
    await writeFile(original, "source evidence");
    const { quarantinePath } = await quarantineMigrationUnit({
      base,
      kind,
      relativePath,
      error: new Error("Unidentified source"),
      move: true,
    });
    const held = join(base, quarantinePath);
    const receipt = `${held}.reason.json`;
    const published = await readFile(receipt, "utf8");
    const invalid = JSON.parse(published);
    delete invalid[field];
    const damaged = JSON.stringify(invalid);
    await writeFile(receipt, damaged);
    await assert.rejects(releaseQuarantinedUnits({ base, kind }), {
      code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
    });
    assert.equal(await readFile(receipt, "utf8"), damaged);
    assert.equal(await readFile(held, "utf8"), "source evidence");
    await assert.rejects(stat(original), { code: "ENOENT" });
    await writeFile(receipt, published);
    assert.deepEqual(await releaseQuarantinedUnits({ base, kind }), [relativePath]);
    assert.equal(await readFile(original, "utf8"), "source evidence");
  });
}

test("partition upgrade rejects a missing budget before publishing any discovered session", async (t) => {
  const { base, sessionDir } = await migratedWorkspace(t);
  await assert.rejects(
    upgradeSessionPartitionStorage({
      base,
      scopedSessionRoots: [],
      onSessionProcessed: () => assert.fail("A session was processed without a budget"),
    }),
    { message: "Invalid partition session storage budget fields" },
  );
  await assert.rejects(stat(partitionMigrationAuthorityPath(sessionDir)), { code: "ENOENT" });
  await rm(sessionDir, { recursive: true });
  await assert.rejects(
    upgradeSessionPartitionStorage({
      base,
      scopedSessionRoots: [],
      onSessionProcessed: () => assert.fail("An empty workspace processed a session"),
    }),
    { message: "Invalid partition session storage budget fields" },
  );
});

test("workspace cutover blocks when a held source has no quarantine receipt", async (t) => {
  const { base, sessionDir } = await migratedWorkspace(t);
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 45 }));
  const kind = "source-upgrade";
  const held = join(
    WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR,
    kind,
    WORKSPACE_LAYOUT.SESSION_DIR,
    "unrecorded-source",
    "session.json",
  );
  await mkdir(dirname(join(base, held)), { recursive: true });
  await writeFile(join(base, held), "source evidence");

  const [blocked] = await upgradeWorkspaceLayout({
    base,
    scopedSessionRoots: [],
    storageService: TEST_STORAGE_SERVICE,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
  });
  assert.equal(blocked.failed.code, "SESSION_STORAGE_UPGRADE_BLOCKED");
  assert.deepEqual(blocked.failed.details.quarantinePaths, [held]);
  assert.equal(JSON.parse(await readFile(state)).version, 45);
  await assert.rejects(stat(partitionMigrationAuthorityPath(sessionDir)), { code: "ENOENT" });
  assert.equal(await readFile(join(base, held), "utf8"), "source evidence");
});

test("quarantine recovery treats a held directory as one unit and validates its recorded identity", async (t) => {
  const { base } = await migratedWorkspace(t);
  const kind = "source-upgrade";
  const relativePath = join(WORKSPACE_LAYOUT.SESSION_DIR, "unidentified-source");
  const original = join(base, relativePath);
  await mkdir(original);
  await writeFile(join(original, "diagnostics.reason.json"), "diagnostics");
  const { quarantinePath } = await quarantineMigrationUnit({
    base,
    kind,
    relativePath,
    error: new Error("Unidentified source"),
    move: true,
  });
  const held = join(base, quarantinePath);
  const receipt = `${held}.reason.json`;
  const published = await readFile(receipt, "utf8");
  await writeFile(receipt, JSON.stringify({ ...JSON.parse(published), moveIdentity: "different" }));
  await assert.rejects(releaseQuarantinedUnits({ base, kind }), {
    code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
  });
  await assert.rejects(stat(original), { code: "ENOENT" });
  await writeFile(receipt, published);
  assert.deepEqual(await releaseQuarantinedUnits({ base, kind }), [relativePath]);
  assert.equal(await readFile(join(original, "diagnostics.reason.json"), "utf8"), "diagnostics");
});

test("workspace cutover blocks before publishing while a moved source is quarantined", async (t) => {
  const { base, sessionDir } = await migratedWorkspace(t);
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 45 }));
  const plan = {
    base,
    scopedSessionRoots: [],
    storageService: TEST_STORAGE_SERVICE,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
  };
  const relativePath = join(WORKSPACE_LAYOUT.SESSION_DIR, "unidentified-source");
  await mkdir(join(base, relativePath));
  const predecessor = join(base, relativePath, "session.json");
  await writeFile(predecessor, "invalid session source");
  const kind = "source-upgrade";
  const { quarantinePath } = await quarantineMigrationUnit({
    base,
    kind,
    relativePath,
    error: new Error("Unidentified source"),
    move: true,
  });
  const marker = partitionMigrationAuthorityPath(sessionDir);
  await assert.rejects(stat(predecessor), { code: "ENOENT" });
  const [blocked] = await upgradeWorkspaceLayout(plan);
  assert.equal(blocked.failed.code, "SESSION_STORAGE_UPGRADE_BLOCKED");
  assert.ok(blocked.failed.details.quarantinePaths.includes(quarantinePath));
  assert.equal(JSON.parse(await readFile(state)).version, 45);
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await assert.rejects(stat(partitionMigrationRoot(sessionDir)), { code: "ENOENT" });
  await writeFile(state, JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION }));
  await assert.rejects(upgradeWorkspaceLayout(plan), {
    code: "SESSION_STORAGE_UPGRADE_BLOCKED",
    details: { quarantinePaths: [quarantinePath] },
  });
  await assert.rejects(stat(predecessor), { code: "ENOENT" });
  await writeFile(state, JSON.stringify({ version: 45 }));

  await assert.rejects(readPartitionStorageRoot(sessionDir), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  await mkdir(join(base, relativePath));
  await writeFile(predecessor, "restored independently");
  await assert.rejects(releaseQuarantinedUnits({ base, kind }), {
    code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
  });
  assert.equal(await readFile(predecessor, "utf8"), "restored independently");
  await rm(join(base, relativePath), { recursive: true });
  assert.deepEqual(await releaseQuarantinedUnits({ base, kind }), [relativePath]);
  const [invalid] = await upgradeWorkspaceLayout(plan);
  assert.equal(invalid.failed.code, "SESSION_STORAGE_UPGRADE_BLOCKED");
  await assert.rejects(stat(marker), { code: "ENOENT" });
});

test("workspace cutover publishes its only write authority and validates it on retry", async (t) => {
  const { base, sessionDir } = await migratedWorkspace(t);
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 45 }));
  const plan = {
    base,
    scopedSessionRoots: [],
    storageService: TEST_STORAGE_SERVICE,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
  };
  const shared = await acquireWorkspaceStorageLock(dirname(base));
  try {
    await assert.rejects(upgradeWorkspaceLayout({ ...plan, signal: AbortSignal.timeout(100) }), {
      name: "TimeoutError",
    });
    assert.equal(JSON.parse(await readFile(state)).version, 45);
    await assert.rejects(stat(partitionMigrationAuthorityPath(sessionDir)), { code: "ENOENT" });
  } finally {
    await shared.close();
  }
  const [{ result: first }] = await upgradeWorkspaceLayout(plan);
  assert.deepEqual(first.nativePartition, []);
  assert.deepEqual(
    first.receipts.map((receipt) => receipt.sessionDir),
    [sessionDir],
  );
  assert.equal(await readPartitionStorageRoot(sessionDir), partitionMigrationRoot(sessionDir));
  assert.equal(JSON.parse(await readFile(state)).version, WORKSPACE_LAYOUT_VERSION);
  assert.deepEqual(await upgradeWorkspaceLayout(plan), []);
  const installed = await readFile(partitionMigrationAuthorityPath(sessionDir));
  let processed = 0;
  const replay = await upgradeSessionPartitionStorage({
    ...plan,
    onSessionProcessed: () => {
      processed += 1;
    },
  });
  assert.deepEqual(replay, first);
  assert.equal(processed, 1);
  assert.deepEqual(await readFile(partitionMigrationAuthorityPath(sessionDir)), installed);
});

test("competing upgrades re-read the layout version after acquiring the exclusive lease", async (t) => {
  const { base, sessionDir } = await migratedWorkspace(t);
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 45 }));
  const competing = Promise.withResolvers();
  const plan = {
    base,
    scopedSessionRoots: [],
    storageService: TEST_STORAGE_SERVICE,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    signal: AbortSignal.timeout(10000),
  };
  const lock = () =>
    acquireWorkspaceStorageLock(dirname(base), { shared: false, signal: plan.signal });
  const first = await lock();
  const waiting = upgradeWorkspaceLayout({
    ...plan,
    reportProgress: () => assert.fail("The waiting upgrade entered a migration step"),
    startupStorage: {
      async withExclusive(operation) {
        competing.resolve();
        const lease = await lock();
        try {
          return await operation();
        } finally {
          await lease.close();
        }
      },
    },
  });
  const applying = competing.promise.then(async () => {
    try {
      return await upgradeWorkspaceLayout({
        ...plan,
        startupStorage: { withExclusive: (operation) => operation() },
      });
    } finally {
      await first.close();
    }
  });
  const [applied, skipped] = await Promise.all([applying, waiting]);
  assert.equal(applied.length, 2);
  assert.equal(applied[0].id, "session-partition-storage-v46");
  assert.deepEqual(
    applied[0].result.receipts.map((receipt) => receipt.sessionDir),
    [sessionDir],
  );
  assert.deepEqual(applied[1].result, { upgraded: [] });
  assert.deepEqual(skipped, []);
  assert.equal(JSON.parse(await readFile(state)).version, WORKSPACE_LAYOUT_VERSION);
});
