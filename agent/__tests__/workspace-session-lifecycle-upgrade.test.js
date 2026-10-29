/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { upgradeSessionLifecycle } from "../src/workspace-lifecycle/session-lifecycle-upgrade.js";
import { releaseQuarantinedUnits } from "../src/workspace-lifecycle/migration-quarantine.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";

const RECORDS = WORKSPACE_LAYOUT.RETIRED_SESSION_LIFECYCLE_RECORDS_DIR;
const TOMBSTONE = WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE;
const DELETED_AT = "2026-05-14T00:00:00.000Z";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-lifecycle-upgrade-"));
  const base = path.join(root, "user-1");
  const backupBase = path.join(root, "backup");
  const at = (relativePath) => path.join(base, relativePath);
  return {
    base,
    backupBase,
    write: async (relativePath, value) => {
      await mkdir(path.dirname(at(relativePath)), { recursive: true });
      await writeFile(at(relativePath), JSON.stringify(value));
    },
    exists: (relativePath) =>
      access(at(relativePath)).then(
        () => true,
        () => false,
      ),
    readJson: async (relativePath) => JSON.parse(await readFile(at(relativePath), "utf8")),
    readBackup: async (relativePath) =>
      JSON.parse(await readFile(path.join(backupBase, relativePath), "utf8")),
    restore: () => rm(root, { recursive: true, force: true }),
  };
}

const activeRecord = { schemaVersion: 1, sessionId: "s-active", generation: 2, state: "active" };
const deletedRecord = {
  schemaVersion: 1,
  sessionId: "s-deleted",
  generation: 3,
  state: "deleted",
  deletedAt: DELETED_AT,
};
const repair = {
  status: "failed",
  errorCode: "SESSION_ARTIFACT_MISSING",
  message: "Canonical session artifact is missing",
  failedAt: "2026-05-14T00:00:02.000Z",
  trigger: { code: "E", message: "broken" },
};
const failedRepairRecord = {
  schemaVersion: 1,
  sessionId: "s-broken",
  generation: 1,
  state: "active",
  repair,
  updatedAt: "2026-05-14T00:00:02.000Z",
};

test("v4 moves deletion into the tombstone, retires every record and removes the records directory", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${RECORDS}/s-active.json`, activeRecord);
    await fixture.write(`${RECORDS}/s-deleted.json`, deletedRecord);
    await fixture.write(`${RECORDS}/s-broken.json`, failedRepairRecord);
    const result = await upgradeSessionLifecycle(fixture);

    assert.deepEqual(
      result.retired.map((item) => item.path),
      [`${RECORDS}/s-active.json`, `${RECORDS}/s-broken.json`, `${RECORDS}/s-deleted.json`],
    );
    assert.equal("rewritten" in result, false);
    assert.equal(await fixture.exists(RECORDS), false);
    assert.deepEqual(await fixture.readBackup(`${RECORDS}/s-active.json`), activeRecord);
    assert.deepEqual(await fixture.readBackup(`${RECORDS}/s-broken.json`), failedRepairRecord);
    assert.deepEqual((await fixture.readJson(TOMBSTONE)).sessions, {
      "s-deleted": Date.parse(DELETED_AT),
    });
    assert.deepEqual(await fixture.readBackup(`${RECORDS}/s-deleted.json`), deletedRecord);
  } finally {
    await fixture.restore();
  }
});

test("v4 keeps an existing tombstone entry and is a no-op on re-run", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(TOMBSTONE, { sessions: { "s-deleted": 1 }, updatedAt: "t0" });
    await fixture.write(`${RECORDS}/s-deleted.json`, deletedRecord);
    await upgradeSessionLifecycle(fixture);
    assert.deepEqual(await fixture.readJson(TOMBSTONE), {
      sessions: { "s-deleted": 1 },
      updatedAt: "t0",
    });
    const rerun = await upgradeSessionLifecycle(fixture);
    assert.deepEqual(rerun, {
      retired: [],
      quarantined: [],
      tombstoneSessionsAdded: false,
    });
  } finally {
    await fixture.restore();
  }
});

test("v4 quarantines a deleted record without a valid deletedAt and upgrades the rest", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${RECORDS}/s-deleted.json`, { ...deletedRecord, deletedAt: "" });
    await fixture.write(`${RECORDS}/s-other.json`, { ...deletedRecord, sessionId: "s-other" });
    const result = await upgradeSessionLifecycle(fixture);
    const quarantined = `${WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR}/session-lifecycle/${RECORDS}/s-deleted.json`;
    assert.deepEqual(
      result.quarantined.map((item) => [item.path, item.quarantinePath, item.error.code]),
      [[`${RECORDS}/s-deleted.json`, quarantined, "WORKSPACE_SESSION_LIFECYCLE_UPGRADE_INVALID"]],
    );
    assert.equal(await fixture.exists(`${RECORDS}/s-deleted.json`), false);
    assert.equal((await fixture.readJson(quarantined)).deletedAt, "");
    assert.equal((await fixture.readJson(`${quarantined}.reason.json`)).kind, "session-lifecycle");
    assert.deepEqual(Object.keys((await fixture.readJson(TOMBSTONE)).sessions), ["s-other"]);
    assert.equal(await fixture.exists(`${RECORDS}/s-other.json`), false);
  } finally {
    await fixture.restore();
  }
});

test("v4 retries a released quarantined record once its data can be mapped", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${RECORDS}/s-deleted.json`, { ...deletedRecord, deletedAt: "" });
    const first = await upgradeSessionLifecycle(fixture);
    const quarantined = first.quarantined[0].quarantinePath;
    await fixture.write(quarantined, deletedRecord);
    const released = await releaseQuarantinedUnits({
      base: fixture.base,
      kind: "session-lifecycle",
    });
    assert.deepEqual(released, [`${RECORDS}/s-deleted.json`]);
    assert.equal(await fixture.exists(`${quarantined}.reason.json`), false);
    const retried = await upgradeSessionLifecycle(fixture);
    assert.deepEqual(retried.quarantined, []);
    assert.equal(retried.tombstoneSessionsAdded, true);
    assert.equal(await fixture.exists(`${RECORDS}/s-deleted.json`), false);
    assert.deepEqual(Object.keys((await fixture.readJson(TOMBSTONE)).sessions), ["s-deleted"]);
  } finally {
    await fixture.restore();
  }
});

test("v10 retires repair records left by v4 in a workspace already at layout v9", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${RECORDS}/s-broken.json`, {
      schemaVersion: 1,
      sessionId: "s-broken",
      repair,
      updatedAt: "2026-05-14T00:00:02.000Z",
    });
    await fixture.write(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE, { version: 9 });
    const applied = await upgradeWorkspaceLayout({
      base: fixture.base,
      backupBase: fixture.backupBase,
      created: false,
      scopedSessionRoots: [],
      storageService: TEST_STORAGE_SERVICE,
    });
    assert.deepEqual(
      applied.map((item) => [item.id, item.result?.retired.map((retired) => retired.path)]),
      [
        ["session-lifecycle-records-retired-v10", [`${RECORDS}/s-broken.json`]],
        ["session-orphan-tool-calls-v11", undefined],
      ],
    );
    assert.equal(await fixture.exists(RECORDS), false);
    assert.equal((await fixture.readBackup(`${RECORDS}/s-broken.json`)).repair.status, "failed");
    assert.equal((await fixture.readJson(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE)).version, 10);
  } finally {
    await fixture.restore();
  }
});
