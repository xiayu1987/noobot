/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_ARTIFACT_FILE_NAMES } from "../src/session/session-artifact-files.js";
import {
  readSessionDirectory,
  walkSessionManifestDirectories,
} from "../src/workspace-lifecycle/session-directory-walk.js";
import {
  ensureSessionTree,
  upgradeSessionStorage,
} from "../src/workspace-lifecycle/session-storage-upgrade.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "storage-structure-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  await mkdir(root, { recursive: true });
  return { base, root, backupBase: join(base, "backup") };
}

async function collect(directory) {
  const sessions = [];
  for await (const session of walkSessionManifestDirectories(directory)) sessions.push(session);
  return sessions;
}

test("session discovery distinguishes an absent root from an obstructed root", async (t) => {
  const { root } = await fixture(t);
  const absent = join(root, "absent");
  assert.deepEqual(await collect(absent), []);
  await writeFile(absent, "directory obstruction");
  for (const directory of [absent, join(absent, "child")]) {
    await assert.rejects(readSessionDirectory(directory), { code: "ENOTDIR" });
    await assert.rejects(collect(directory), { code: "ENOTDIR" });
  }
  assert.equal(await readFile(absent, "utf8"), "directory obstruction");
});

test("tree recovery does not publish an empty tree over an obstructed session root", async (t) => {
  const options = await fixture(t);
  await rm(options.root, { recursive: true });
  await writeFile(options.root, "session evidence");
  await assert.rejects(ensureSessionTree(options), { code: "ENOTDIR" });
  await assert.rejects(readFile(join(options.base, WORKSPACE_LAYOUT.SESSION_TREE_FILE)), {
    code: "ENOTDIR",
  });
  await assert.rejects(readFile(join(options.base, WORKSPACE_LAYOUT.SESSION_TREE_UPGRADE_FILE)), {
    code: "ENOTDIR",
  });
  assert.equal(await readFile(options.root, "utf8"), "session evidence");
});

for (const artifact of ["executionReportsDir", "executionEventsDir"]) {
  test(`artifact retirement rejects an obstructed ${artifact} without retiring evidence`, async (t) => {
    const options = await fixture(t);
    const session = join(options.root, "session");
    await mkdir(session);
    const treeFile = join(options.base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    const tree = JSON.stringify({ nodes: {} });
    await writeFile(treeFile, tree);
    await writeFile(join(session, SESSION_ARTIFACT_FILE_NAMES[artifact]), "artifact evidence");
    await assert.rejects(
      upgradeSessionStorage({ ...options, scopedSessionRoots: ["runtime/scoped-sessions"] }),
      { code: "ENOTDIR" },
    );
    assert.equal(await readFile(treeFile, "utf8"), tree);
    assert.equal(
      await readFile(join(session, SESSION_ARTIFACT_FILE_NAMES[artifact]), "utf8"),
      "artifact evidence",
    );
  });
}

for (const { version, artifact } of [
  { version: 5, artifact: "executionEventsDir" },
  { version: 6, artifact: "modelMessageSnapshotsDir" },
]) {
  test(`layout v${version} does not advance past an obstructed ${artifact}`, async (t) => {
    const options = await fixture(t);
    const session = join(options.root, "session");
    await mkdir(session);
    const manifest = join(session, SESSION_ARTIFACT_FILE_NAMES.session);
    await writeFile(manifest, "{}");
    const obstruction = join(session, SESSION_ARTIFACT_FILE_NAMES[artifact]);
    await writeFile(obstruction, "migration evidence");
    const state = join(options.base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
    await mkdir(dirname(state), { recursive: true });
    const installed = JSON.stringify({ version });
    await writeFile(state, installed);
    const results = await upgradeWorkspaceLayout({
      ...options,
      scopedSessionRoots: ["runtime/scoped-sessions"],
      storageService: TEST_STORAGE_SERVICE,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].failed.code, "ENOTDIR");
    assert.equal(await readFile(state, "utf8"), installed);
    assert.equal(await readFile(manifest, "utf8"), "{}");
    assert.equal(await readFile(obstruction, "utf8"), "migration evidence");
  });
}
