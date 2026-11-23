/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import { ATTACHMENT_CATALOG_ERROR } from "@noobot/attachment-protocol";
import { readAttachmentRecords } from "../src/artifacts/index-manager.js";
import { legacyAttachmentScopeIndexPath } from "../src/artifacts/service/attachment-storage-layout.js";
import { toPersistedAttachmentRecord } from "../src/artifacts/service/persisted-record-adapter.js";
import { getFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { upgradeAttachmentCatalogs } from "../src/workspace-lifecycle/attachment-catalog-upgrade.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { acquireWorkspaceStorageLock } from "../src/workspace-lifecycle/workspace-storage-lock.js";
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";

test("v45 verifies the catalog on restart before retiring the source index", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "attachment-catalog-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = join(root, "u1");
  const backupBase = join(root, "backup");
  const scope = { sessionId: "s1", attachmentSource: "user" };
  const legacy = legacyAttachmentScopeIndexPath(base, scope);
  const layout = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  const path = join(dirname(legacy), "body.txt");
  await mkdir(dirname(legacy), { recursive: true });
  await writeFile(path, "body");
  await writeFile(layout, JSON.stringify({ version: 44 }));
  const timestamp = "2026-01-01T00:00:00.000Z";
  const legacyRecord = toPersistedAttachmentRecord(base, {
    ...scope,
    attachmentId: "a1",
    name: "body.txt",
    path,
    mimeType: "text/plain",
    size: 4,
    relations: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const raw = JSON.stringify({ ...scope, updatedAt: timestamp, attachments: { a1: legacyRecord } });
  await writeFile(legacy, raw);
  const upgrade = (signal) =>
    upgradeWorkspaceLayout({
      base,
      backupBase,
      created: false,
      scopedSessionRoots: [],
      targetStorageBudget: createTestPartitionStorageBudget(),
      signal,
    });
  const shared = await acquireWorkspaceStorageLock(root);
  try {
    await assert.rejects(upgrade(AbortSignal.timeout(100)), { name: "TimeoutError" });
    assert.equal(JSON.parse(await readFile(layout, "utf8")).version, 44);
    assert.equal(await readFile(legacy, "utf8"), raw);
  } finally {
    await shared.close();
  }
  const adapter = getFsAdapter();
  const remove = adapter.rm.bind(adapter);
  const failure = Object.assign(new Error("interrupted before source retirement"), { code: "EIO" });
  const fault = t.mock.method(adapter, "rm", (target, options) => {
    if (target === legacy) throw failure;
    return remove(target, options);
  });
  const [interrupted] = await upgrade();
  fault.mock.restore();
  assert.equal(interrupted.failed.code, "EIO");
  assert.equal(JSON.parse(await readFile(layout, "utf8")).version, 44);
  assert.equal(await readFile(legacy, "utf8"), raw);
  await assert.rejects(readAttachmentRecords(base, scope, ["a1"]), {
    code: ATTACHMENT_CATALOG_ERROR.UPGRADE_REQUIRED,
  });
  const [completed, partition] = await upgrade();
  assert.equal(completed.failed, undefined, JSON.stringify(completed));
  assert.deepEqual(completed.result, { migrated: 1 });
  assert.equal(partition.failed, undefined, JSON.stringify(partition));
  assert.equal(JSON.parse(await readFile(layout, "utf8")).version, WORKSPACE_LAYOUT_VERSION);
  await assert.rejects(stat(legacy), { code: "ENOENT" });
  assert.equal(await readFile(join(backupBase, relative(base, legacy)), "utf8"), raw);
  const [record] = await readAttachmentRecords(base, scope, ["a1"]);
  assert.equal(record.path, path);
  assert.equal(record.size, 4);
  assert.equal(await readFile(record.path, "utf8"), "body");
  assert.deepEqual(await upgrade(), []);
  assert.deepEqual(await upgradeAttachmentCatalogs({ base, backupBase, onSessionProcessed() {} }), {
    migrated: 0,
  });
});
