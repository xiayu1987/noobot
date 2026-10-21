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
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { EXECUTION_REPORT_VERSION } from "@noobot/session-protocol/execution-report";
import { ensureUserWorkspace } from "../src/workspace-lifecycle/index.js";
import { upgradeSessionStorage } from "../src/workspace-lifecycle/session-storage-upgrade.js";

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
    options: {
      workspaceRoot,
      assetPackagePath,
      userId: "user-1",
      baseValues: {},
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    },
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
  await fixture.write(`${SESSION_DIR}/s-2/session.json`, {
    sessionId: "s-2",
    parentSessionId: "s-1",
    caller: SESSION_CALLER.BOT,
  });
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
        "s-1": { sessionId: "s-1", parentSessionId: "", caller: SESSION_CALLER.USER },
        "s-2": { sessionId: "s-2", parentSessionId: "s-1", caller: SESSION_CALLER.BOT },
      },
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

async function upgradeFromV2(fixture, tree) {
  await fixture.write(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE, { version: 2 });
  await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, tree);
  await ensureUserWorkspace(fixture.options);
  return readBackupStamp(fixture);
}

async function writeSessionDocument(fixture, directory, parentSessionId, caller) {
  await fixture.write(`runtime/session/${directory}/session.json`, {
    sessionId: directory.split("/").at(-1),
    parentSessionId,
    caller,
  });
}

test("v2 workspace drops session tree timestamps duplicated from session documents", async () => {
  const fixture = await createFixture();
  try {
    const tree = {
      nodes: { "s-1": { sessionId: "s-1", parentSessionId: "", createdAt: "t0", updatedAt: "t1" } },
      updatedAt: "t2",
    };
    const stamp = await upgradeFromV2(fixture, tree);
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.SESSION_TREE_FILE), {
      nodes: { "s-1": { sessionId: "s-1", parentSessionId: "", caller: SESSION_CALLER.USER } },
    });
    assert.deepEqual(
      await fixture.readJson(`${stamp}/${WORKSPACE_LAYOUT.SESSION_TREE_FILE}`),
      tree,
    );
  } finally {
    await fixture.restore();
  }
});

test("corrupt session tree is rebuilt from session documents", async () => {
  const fixture = await createFixture();
  try {
    await writeSessionDocument(fixture, "s-1", "", SESSION_CALLER.USER);
    await writeSessionDocument(fixture, "s-1/s-2", "s-1", SESSION_CALLER.BOT);
    await fixture.write("runtime/session/orphan/events/x.jsonl", "{}\n");
    const stamp = await upgradeFromV2(fixture, "{not json");
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.SESSION_TREE_FILE), {
      nodes: {
        "s-1": { sessionId: "s-1", parentSessionId: "", caller: SESSION_CALLER.USER },
        "s-2": { sessionId: "s-2", parentSessionId: "s-1", caller: SESSION_CALLER.BOT },
      },
    });
    assert.equal(
      await readFile(fixture.at(`${stamp}/${WORKSPACE_LAYOUT.SESSION_TREE_FILE}`), "utf8"),
      "{not json",
    );
    assert.equal(await fixture.exists("runtime/session/orphan/events/x.jsonl"), true);
  } finally {
    await fixture.restore();
  }
});

test("corrupt session tree retires only the sessions whose documents cannot be placed", async () => {
  const fixture = await createFixture();
  try {
    await writeSessionDocument(fixture, "s-1", "", SESSION_CALLER.USER);
    await writeSessionDocument(fixture, "s-2", "missing-parent", SESSION_CALLER.USER);
    await writeSessionDocument(fixture, "s-2/s-3", "s-2", SESSION_CALLER.BOT);
    await fixture.write("runtime/session/s-4/session.json", { sessionId: "other" });
    await writeSessionDocument(fixture, "s-5", "s-1", SESSION_CALLER.BOT);
    const stamp = await upgradeFromV2(fixture, "{not json");
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.SESSION_TREE_FILE), {
      nodes: { "s-1": { sessionId: "s-1", parentSessionId: "", caller: SESSION_CALLER.USER } },
    });
    for (const directory of ["s-2", "s-4", "s-5"]) {
      assert.equal(await fixture.exists(`runtime/session/${directory}`), false, directory);
      assert.equal(
        await fixture.exists(`${stamp}/runtime/session/${directory}/session.json`),
        true,
        directory,
      );
    }
    assert.equal(await fixture.exists(`${stamp}/runtime/session/s-2/s-3/session.json`), true);
    assert.equal(
      await readFile(fixture.at(`${stamp}/${WORKSPACE_LAYOUT.SESSION_TREE_FILE}`), "utf8"),
      "{not json",
    );
  } finally {
    await fixture.restore();
  }
});

test("session tree rebuild reports rejected sessions and retires them from disk", async () => {
  const fixture = await createFixture();
  try {
    await writeSessionDocument(fixture, "s-1", "", SESSION_CALLER.USER);
    await writeSessionDocument(fixture, "s-2", "missing-parent", SESSION_CALLER.USER);
    await writeSessionDocument(fixture, "s-2/s-3", "s-2", SESSION_CALLER.BOT);
    await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, "{not json");
    const backupBase = await mkdtemp(path.join(os.tmpdir(), "noobot-tree-rebuild-backup-"));
    try {
      const { sessionTree } = await upgradeSessionStorage({ base: fixture.userPath, backupBase });
      assert.equal(sessionTree.nodes, 1);
      assert.deepEqual(sessionTree.rejected, [
        { sessionId: "s-2", reason: "parent-missing", segments: ["s-2"] },
        { sessionId: "s-3", reason: "parent-rejected", segments: ["s-2", "s-3"] },
      ]);
      assert.deepEqual(sessionTree.retiredSessions, [
        { path: "runtime/session/s-2", backupPath: path.join(backupBase, "runtime/session/s-2") },
      ]);
    } finally {
      await rm(backupBase, { recursive: true, force: true });
    }
  } finally {
    await fixture.restore();
  }
});

test("legacy tree upgrade retires sessions whose persisted parent chain is broken", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, {
      nodes: {
        root: { sessionId: "root", parentSessionId: "" },
        lost: { sessionId: "lost", parentSessionId: "gone" },
      },
    });
    await fixture.write("runtime/session/root/session.json", { caller: SESSION_CALLER.USER });
    await fixture.write("runtime/session/gone/lost/session.json", { caller: SESSION_CALLER.BOT });
    const backupBase = await mkdtemp(path.join(os.tmpdir(), "noobot-tree-legacy-backup-"));
    try {
      const { sessionTree } = await upgradeSessionStorage({ base: fixture.userPath, backupBase });
      assert.equal(sessionTree.nodes, 1);
      assert.deepEqual(sessionTree.rejected, [{ sessionId: "lost", reason: "parent-missing" }]);
      assert.deepEqual(sessionTree.retiredSessions, [
        {
          path: "runtime/session/gone/lost",
          backupPath: path.join(backupBase, "runtime/session/gone/lost"),
        },
      ]);
      assert.equal(await fixture.exists("runtime/session/root/session.json"), true);
    } finally {
      await rm(backupBase, { recursive: true, force: true });
    }
  } finally {
    await fixture.restore();
  }
});

test("corrupt execution index has no other fact source and is retired", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(`${SESSION_DIR}/execution-events/index.json`, "{not json");
    await ensureUserWorkspace(fixture.options);
    const stamp = await readBackupStamp(fixture);
    assert.equal(await fixture.exists(`${SESSION_DIR}/execution-events`), false);
    assert.equal(
      await readFile(fixture.at(`${stamp}/${SESSION_DIR}/execution-events/index.json`), "utf8"),
      "{not json",
    );
  } finally {
    await fixture.restore();
  }
});

test("v4 workspace fills session tree callers from nested session documents", async () => {
  const fixture = await createFixture();
  try {
    const tree = {
      nodes: {
        root: { sessionId: "root", parentSessionId: "" },
        child: { sessionId: "child", parentSessionId: "root" },
      },
    };
    await fixture.write(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE, { version: 4 });
    await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, tree);
    await fixture.write("runtime/session/root/session.json", { caller: SESSION_CALLER.USER });
    await fixture.write("runtime/session/root/child/session.json", {
      caller: SESSION_CALLER.BOT,
    });
    await ensureUserWorkspace(fixture.options);
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.SESSION_TREE_FILE), {
      nodes: {
        root: { sessionId: "root", parentSessionId: "", caller: SESSION_CALLER.USER },
        child: { sessionId: "child", parentSessionId: "root", caller: SESSION_CALLER.BOT },
      },
    });
    const stamp = await readBackupStamp(fixture);
    assert.deepEqual(
      await fixture.readJson(`${stamp}/${WORKSPACE_LAYOUT.SESSION_TREE_FILE}`),
      tree,
    );
  } finally {
    await fixture.restore();
  }
});

test("layout upgrade rejects a corrupted session manifest and leaves it untouched", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE, { version: 5 });
    await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, {
      nodes: {
        root: { sessionId: "root", parentSessionId: "", caller: SESSION_CALLER.USER },
        broken: { sessionId: "broken", parentSessionId: "root", caller: SESSION_CALLER.USER },
      },
    });
    await fixture.write("runtime/session/root/session.json", { caller: SESSION_CALLER.USER });
    await fixture.write("runtime/session/root/broken/session.json", "{not json");
    await assert.rejects(ensureUserWorkspace(fixture.options), {
      code: "WORKSPACE_SESSION_TRANSFER_ENVELOPE_UPGRADE_INVALID",
      details: {
        reason: "invalid_json",
        filePath: fixture.at("runtime/session/root/broken/session.json"),
      },
    });
    assert.equal(
      await readFile(fixture.at("runtime/session/root/broken/session.json"), "utf8"),
      "{not json",
    );
    assert.deepEqual(await fixture.readJson(WORKSPACE_LAYOUT.LAYOUT_STATE_FILE), { version: 5 });
  } finally {
    await fixture.restore();
  }
});

test("session tree caller upgrade reports only the sessions whose caller was repaired", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(WORKSPACE_LAYOUT.SESSION_TREE_FILE, {
      nodes: {
        root: { sessionId: "root", parentSessionId: "" },
        broken: { sessionId: "broken", parentSessionId: "root" },
      },
    });
    await fixture.write("runtime/session/root/session.json", { caller: SESSION_CALLER.BOT });
    await fixture.write("runtime/session/root/broken/session.json", "{not json");
    const backupBase = await mkdtemp(path.join(os.tmpdir(), "noobot-caller-upgrade-backup-"));
    try {
      const { sessionTree } = await upgradeSessionStorage({ base: fixture.userPath, backupBase });
      assert.deepEqual(sessionTree.repairedCallers, ["broken"]);
      assert.equal(sessionTree.nodes, 2);
    } finally {
      await rm(backupBase, { recursive: true, force: true });
    }
  } finally {
    await fixture.restore();
  }
});
