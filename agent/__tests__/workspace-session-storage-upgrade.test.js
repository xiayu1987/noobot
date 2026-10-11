/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import { EXECUTION_REPORT_VERSION } from "@noobot/session-protocol/execution-report";
import { ensureUserWorkspace } from "../src/workspace-lifecycle/index.js";

const SESSION_DIR = "runtime/session/s-1";
const NESTED_DIR = "runtime/plugin-data/workflow/session/run-1/node-1";
const LEGACY_TREE = {
  roots: ["s-1"],
  nodes: {
    "s-1": { sessionId: "s-1", parentSessionId: "", children: ["s-2"], createdAt: "t0" },
    "s-2": { sessionId: "s-2", parentSessionId: "s-1", children: [], createdAt: "t1" },
  },
  updatedAt: "t2",
};

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-storage-upgrade-"));
  const workspaceRoot = path.join(root, "workspace");
  const assetPackagePath = path.join(root, "assets");
  const userPath = path.join(workspaceRoot, "user-1");
  await mkdir(assetPackagePath, { recursive: true });
  const at = (relativePath) => path.join(userPath, relativePath);
  return {
    userPath,
    options: { workspaceRoot, assetPackagePath, userId: "user-1", baseValues: {} },
    at,
    write: async (relativePath, value) => {
      await mkdir(path.dirname(at(relativePath)), { recursive: true });
      await writeFile(at(relativePath), typeof value === "string" ? value : JSON.stringify(value));
    },
    readJson: async (relativePath) => JSON.parse(await readFile(at(relativePath), "utf8")),
    exists: (relativePath) =>
      access(at(relativePath)).then(
        () => true,
        () => false,
      ),
    restore: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(`${path.resolve(workspaceRoot)}.mutation-locks`, { recursive: true, force: true });
    },
  };
}

async function seedLegacySessionStorage(fixture) {
  await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, LEGACY_TREE);
  for (const dir of [SESSION_DIR, NESTED_DIR]) {
    await fixture.write(`${dir}/execution-events/index.json`, { schemaVersion: 1, segments: [] });
    await fixture.write(`${dir}/execution-events/segment-000001.jsonl`, "{}\n");
    await fixture.write(`${dir}/execution-reports/old.json`, { version: 3 });
  }
  await fixture.write(`${SESSION_DIR}/execution-reports/current.json`, {
    version: EXECUTION_REPORT_VERSION,
  });
}

async function readBackupStamp(fixture) {
  const backupRoot = fixture.at(WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR);
  const stamps = await readdir(backupRoot);
  assert.equal(stamps.length, 1);
  return `${WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR}/${stamps[0]}`;
}

test("unmarked workspace maps the legacy session tree and retires v1 artifacts", async () => {
  const fixture = await createFixture();
  try {
    await seedLegacySessionStorage(fixture);
    await ensureUserWorkspace(fixture.options);

    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.SESSION_TREE_FILE), {
      nodes: {
        "s-1": { sessionId: "s-1", parentSessionId: "", createdAt: "t0" },
        "s-2": { sessionId: "s-2", parentSessionId: "s-1", createdAt: "t1" },
      },
      updatedAt: "t2",
    });
    const stamp = await readBackupStamp(fixture);
    assert.deepEqual(
      await fixture.readJson(`${stamp}/${WORKSPACE_LAYOUT.SESSION_TREE_FILE}`),
      LEGACY_TREE,
    );
    for (const dir of [SESSION_DIR, NESTED_DIR]) {
      assert.equal(await fixture.exists(`${dir}/execution-events`), false, dir);
      assert.equal(await fixture.exists(`${dir}/execution-reports/old.json`), false, dir);
      assert.deepEqual(await fixture.readJson(`${stamp}/${dir}/execution-events/index.json`), {
        schemaVersion: 1,
        segments: [],
      });
      assert.deepEqual(await fixture.readJson(`${stamp}/${dir}/execution-reports/old.json`), {
        version: 3,
      });
    }
    assert.deepEqual(await fixture.readJson(`${SESSION_DIR}/execution-reports/current.json`), {
      version: EXECUTION_REPORT_VERSION,
    });
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE), {
      version: WORKSPACE_LAYOUT_VERSION,
    });
  } finally {
    await fixture.restore();
  }
});

test("new workspace is marked current without running session storage upgrades", async () => {
  const fixture = await createFixture();
  try {
    await ensureUserWorkspace(fixture.options);
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE), {
      version: WORKSPACE_LAYOUT_VERSION,
    });
    assert.equal(await fixture.exists(WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR), false);
  } finally {
    await fixture.restore();
  }
});

test("current workspace skips the session storage scan", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE, {
      version: WORKSPACE_LAYOUT_VERSION,
    });
    await fixture.write(`${SESSION_DIR}/execution-events/index.json`, { schemaVersion: 1 });
    await ensureUserWorkspace(fixture.options);
    assert.deepEqual(await fixture.readJson(`${SESSION_DIR}/execution-events/index.json`), {
      schemaVersion: 1,
    });
  } finally {
    await fixture.restore();
  }
});

test("upgrade is applied once and later ensures are no-ops", async () => {
  const fixture = await createFixture();
  try {
    await seedLegacySessionStorage(fixture);
    await ensureUserWorkspace(fixture.options);
    const stamp = await readBackupStamp(fixture);
    await ensureUserWorkspace(fixture.options);
    assert.equal(await readBackupStamp(fixture), stamp);
  } finally {
    await fixture.restore();
  }
});
