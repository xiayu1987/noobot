/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import { WORKSPACE_LAYOUT_UPGRADE_OWNER as OWNER } from "@noobot/workspace-protocol/layout-migration";
import { retireUnsupportedSessionStorage } from "../src/workspace-lifecycle/session-storage-retirement.js";
import {
  assertWorkspaceQuarantineEmpty,
  listQuarantinedUnits,
  quarantineMigrationUnit,
} from "../src/workspace-lifecycle/migration-quarantine.js";
import {
  upgradeWorkspaceLayout,
  assertWorkspaceStorageReady,
} from "../src/workspace-lifecycle/sections.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "storage-retirement-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

async function oldSession(base, id) {
  const dir = join(base, WORKSPACE_LAYOUT.SESSION_DIR, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "head.json"), "retained old bytes");
  return dir;
}

test("historical failures retain their evidence without blocking upgrade or inventing a format", async (t) => {
  const base = await fixture(t);
  const held = await oldSession(base, "held");
  await oldSession(base, "active");
  for (const [relativePath, move] of [
    [join(WORKSPACE_LAYOUT.SESSION_DIR, "held"), true],
    [join(WORKSPACE_LAYOUT.SESSION_DIR, "active"), false],
    [join(WORKSPACE_LAYOUT.SESSION_DIR, "absent"), false],
  ])
    await quarantineMigrationUnit({
      base,
      kind: OWNER.SESSION_LIFECYCLE,
      relativePath,
      move,
      error: Object.assign(new Error("historical failure"), { code: "OLD_FAILURE" }),
    });
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(join(state, ".."), { recursive: true });
  await writeFile(state, JSON.stringify({ version: 47 }));
  const results = await upgradeWorkspaceLayout({
    base,
    backupBase: join(base, "backups"),
    scopedSessionRoots: [],
    targetStorageBudget: createTestPartitionStorageBudget(),
  });
  assert.equal(
    results.some((item) => item.failed),
    false,
  );
  const records = await listQuarantinedUnits({ base });
  const historical = records.filter(({ kind }) => kind === OWNER.SESSION_LIFECYCLE);
  assert.equal(historical.length, 3);
  for (const record of historical) {
    assert.deepEqual(record.sessionStorage, {
      format: "unverified",
      status: "historical-upgrade-failed",
    });
    assert.equal(record.error.code, "OLD_FAILURE");
  }
  const retained = historical.find(({ moved }) => moved);
  assert.equal(
    await readFile(join(base, retained.quarantinePath, "head.json"), "utf8"),
    "retained old bytes",
  );
  assert.equal(
    records.find(({ path, kind }) => path.endsWith("active") && kind !== OWNER.SESSION_LIFECYCLE)
      .sessionStorage.status,
    "unsupported-format",
  );
  await assert.rejects(readFile(join(held, "head.json")), { code: "ENOENT" });
  await assertWorkspaceStorageReady(base, "test");
  assert.deepEqual(await upgradeWorkspaceLayout({ base, scopedSessionRoots: [] }), []);
  assert.deepEqual(await listQuarantinedUnits({ base }), records);
});

test("old parent and partition child have independent retained sources and classifications", async (t) => {
  const base = await fixture(t);
  const parent = await oldSession(base, "parent");
  await mkdir(join(parent, "child"));
  await writeFile(join(parent, "child", "CURRENT"), "partition bytes");
  const result = await retireUnsupportedSessionStorage({ base, scopedSessionRoots: [] });
  assert.equal(result.quarantined.length, 2);
  const units = await listQuarantinedUnits({ base });
  assert.equal(units.length, 2);
  const child = units.find((unit) => unit.sessionStorage.format === "partition");
  const old = units.find((unit) => unit.sessionStorage.format === "immutable");
  assert.equal(child.sessionStorage.status, "parent-unavailable");
  assert.equal(child.sessionStorage.parentPath, old.path);
  assert.equal(old.sessionStorage.status, "unsupported-format");
  assert.equal(
    await readFile(join(base, child.quarantinePath, "CURRENT"), "utf8"),
    "partition bytes",
  );
  assert.equal(
    await readFile(join(base, old.quarantinePath, "head.json"), "utf8"),
    "retained old bytes",
  );
  await assertWorkspaceQuarantineEmpty(base);
  assert.deepEqual(await retireUnsupportedSessionStorage({ base, scopedSessionRoots: [] }), {
    quarantined: [],
  });
});

test("a durable reason resumes an interrupted move before retirement is retried", async (t) => {
  const base = await fixture(t);
  const source = await oldSession(base, "interrupted");
  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      if (from === source) throw Object.assign(new Error("injected move failure"), { code: "EIO" });
      return adapter.rename(from, to);
    },
  });
  try {
    await assert.rejects(retireUnsupportedSessionStorage({ base, scopedSessionRoots: [] }), {
      code: "EIO",
    });
  } finally {
    setFsAdapter(adapter);
  }
  await assertWorkspaceQuarantineEmpty(base);
  const [unit] = await listQuarantinedUnits({ base });
  assert.equal(
    await readFile(join(base, unit.quarantinePath, "head.json"), "utf8"),
    "retained old bytes",
  );
});

test("retained sources do not reserve an active session path", async (t) => {
  const base = await fixture(t);
  const source = await oldSession(base, "reused");
  const options = { base, scopedSessionRoots: [] };
  const [first] = (await retireUnsupportedSessionStorage(options)).quarantined;
  await oldSession(base, "reused");
  await writeFile(join(source, "head.json"), "different old source");
  await assertWorkspaceQuarantineEmpty(base);
  assert.equal(await readFile(join(source, "head.json"), "utf8"), "different old source");
  const [second] = (await retireUnsupportedSessionStorage(options)).quarantined;
  assert.notEqual(first.quarantinePath, second.quarantinePath);
  assert.equal(
    await readFile(join(base, first.quarantinePath, "head.json"), "utf8"),
    "retained old bytes",
  );
  await assertWorkspaceQuarantineEmpty(base);
});

test("unsupported sessions do not block layout upgrade or readiness and are removed from tree", async (t) => {
  const base = await fixture(t);
  await oldSession(base, "old");
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(join(base, ".noobot"), { recursive: true });
  await mkdir(join(state, ".."), { recursive: true });
  await writeFile(state, JSON.stringify({ version: 47 }));
  const results = await upgradeWorkspaceLayout({
    base,
    backupBase: join(base, "backups"),
    scopedSessionRoots: [],
    targetStorageBudget: createTestPartitionStorageBudget(),
  });
  assert.equal(
    results.some((item) => item.failed),
    false,
  );
  assert.equal(JSON.parse(await readFile(state, "utf8")).version, WORKSPACE_LAYOUT_VERSION);
  const tree = JSON.parse(await readFile(join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE), "utf8"));
  assert.deepEqual(tree.nodes, {});
  await assertWorkspaceStorageReady(base, "test");
  assert.deepEqual(await upgradeWorkspaceLayout({ base, scopedSessionRoots: [] }), []);
});

test("non-session quarantine evidence remains unclassified and keeps its own readiness failure", async (t) => {
  const base = await fixture(t);
  await quarantineMigrationUnit({
    base,
    kind: OWNER.ATTACHMENT_CATALOG,
    relativePath: "runtime/attach/catalog.json",
    error: Object.assign(new Error("catalog failure"), { code: "CATALOG_INVALID" }),
  });
  const before = await listQuarantinedUnits({ base });
  await assert.rejects(assertWorkspaceQuarantineEmpty(base), {
    code: "SESSION_STORAGE_UPGRADE_BLOCKED",
  });
  assert.deepEqual(await listQuarantinedUnits({ base }), before);
  assert.equal(Object.hasOwn(before[0], "sessionStorage"), false);
});
