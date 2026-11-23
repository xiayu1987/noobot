/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_STORAGE_JOURNAL_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  planWorkspaceLayoutUpgrades,
} from "@noobot/workspace-protocol";
import { buildHarness } from "./session/scoped-session-repositories.fixtures.js";
import {
  v9Options,
  downgradeSessionStorage,
  saveCanonicalSession,
} from "./helpers/session-identity-upgrade.fixtures.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { readSessionArtifact } from "../src/session/session-artifact-store.js";
import { observeSessionStorageWork } from "../src/session/session-storage-observation.js";

const PREVIOUS_SCHEMA_VERSION = SESSION_ARTIFACT_STORAGE_JOURNAL_SCHEMA_VERSION - 1;
const PREVIOUS_LAYOUT_VERSION = 31;

test("v32 layout upgrade moves installed schema22 sessions onto the storage journal schema", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const sessionDir = await saveCanonicalSession(sessionRepo);
  const expected = await readSessionArtifact({ storageService, sessionDir });
  await downgradeSessionStorage(sessionDir, PREVIOUS_SCHEMA_VERSION);
  const options = v9Options(root);
  const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: PREVIOUS_LAYOUT_VERSION }));
  await assert.rejects(readSessionArtifact({ storageService, sessionDir }), {
    code: SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED,
  });

  const applied = await upgradeWorkspaceLayout({ ...options, created: false });
  assert.deepEqual(
    applied.map(({ id, failed }) => ({ id, failed })),
    planWorkspaceLayoutUpgrades({ installedVersion: PREVIOUS_LAYOUT_VERSION }).map(({ id }) => ({
      id,
      failed: undefined,
    })),
  );
  assert.deepEqual(applied[0].result.quarantined, []);
  assert.equal(applied[0].result.sessions.length, 1);
  assert.equal(JSON.parse(await readFile(layoutFile, "utf8")).version, WORKSPACE_LAYOUT_VERSION);

  const manifest = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
  assert.equal(manifest.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  for (const field of ["messageOrder", "sessionArtifactEvents"])
    assert.equal(Object.hasOwn(manifest, field), false);
  for (const turn of manifest.turnOrder)
    for (const field of ["messageOrder", "messageHashes"])
      assert.equal(Object.hasOwn(turn, field), false);
  const upgraded = await readSessionArtifact({ storageService, sessionDir });
  assert.deepEqual(upgraded.messages, expected.messages);
  assert.deepEqual(upgraded.sessionArtifactEvents, expected.sessionArtifactEvents);

  assert.deepEqual(await upgradeWorkspaceLayout({ ...options, created: false }), []);
});

test("v33 upgrades installed schema23 journals without losing messages or artifact events", async (t) => {
  const harness = buildHarness();
  const { root, sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const sessionDir = await saveCanonicalSession(sessionRepo);
  const expected = await readSessionArtifact({ storageService, sessionDir });
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.schemaVersion = 23;
  const journals = await Promise.all(
    manifest.turnOrder.map((turn) => readFile(path.join(sessionDir, turn.file))),
  );
  await writeFile(manifestFile, JSON.stringify(manifest));
  const options = v9Options(root);
  const layoutFile = path.join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(layoutFile, JSON.stringify({ version: 32 }));
  const { result: applied, work } = await observeSessionStorageWork(() =>
    upgradeWorkspaceLayout({ ...options, created: false }),
  );
  assert.equal(work.indexedMessages || 0, 0);
  assert.equal(work.journalWriteBytes || 0, 0);
  assert.deepEqual(
    applied.map(({ id, failed }) => ({ id, failed })),
    planWorkspaceLayoutUpgrades({ installedVersion: 32 }).map(({ id }) => ({
      id,
      failed: undefined,
    })),
  );
  assert.deepEqual(applied[0].result.quarantined, []);
  assert.equal(applied[0].result.sessions.length, 1);
  const upgraded = await readSessionArtifact({ storageService, sessionDir });
  assert.deepEqual(upgraded.messages, expected.messages);
  assert.deepEqual(upgraded.sessionArtifactEvents, expected.sessionArtifactEvents);
  assert.equal(upgraded.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  const stored = JSON.parse(await readFile(manifestFile, "utf8"));
  assert.deepEqual(stored.artifactEventJournal, manifest.artifactEventJournal);
  assert.deepEqual(
    stored.turnOrder.map(({ file, committedBytes, recordCount }) => ({
      file,
      committedBytes,
      recordCount,
    })),
    manifest.turnOrder.map(({ file, committedBytes, recordCount }) => ({
      file,
      committedBytes,
      recordCount,
    })),
  );
  assert.deepEqual(
    await Promise.all(stored.turnOrder.map((turn) => readFile(path.join(sessionDir, turn.file)))),
    journals,
  );
  assert.deepEqual(await upgradeWorkspaceLayout({ ...options, created: false }), []);
  const canonical = await readFile(manifestFile, "utf8");
  await writeFile(layoutFile, JSON.stringify({ version: 32 }));
  const repeated = await observeSessionStorageWork(() =>
    upgradeWorkspaceLayout({ ...options, created: false }),
  );
  assert.deepEqual(repeated.result[0].result, { sessions: [], quarantined: [] });
  assert.equal(repeated.work.indexedMessages || 0, 0);
  assert.equal(repeated.work.journalWriteBytes || 0, 0);
  assert.equal(repeated.work.manifestWriteBytes || 0, 0);
  assert.equal(await readFile(manifestFile, "utf8"), canonical);
});
