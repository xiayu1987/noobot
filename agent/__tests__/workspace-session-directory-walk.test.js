/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { PARTITION_JOURNAL_DIRECTORIES } from "@noobot/session-protocol/partition-journal";
import { discoverSessionDirectories } from "../src/workspace-lifecycle/session-directory-walk.js";
import { retireUnsupportedSessionStorage } from "../src/workspace-lifecycle/session-storage-retirement.js";
import {
  ensureSessionTree,
  rebuildStoredSessionTree,
} from "../src/workspace-lifecycle/session-storage-upgrade.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { partitionReaderAccess } from "./helpers/partition-reader-fixture.js";
import { emptyPartitionSession } from "./helpers/partition-session-cases.js";

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "session-discovery-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  await mkdir(root, { recursive: true });
  async function write(relative, content = "{}") {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  async function publish(...segments) {
    const scope = {
      sessionDir: path.join(root, ...segments),
      sessionId: segments.at(-1),
      parentSessionId: segments.length > 1 ? segments.at(-2) : "",
    };
    await partitionReaderAccess.create(scope, {
      operationId: "create",
      session: {
        ...emptyPartitionSession({ ...scope, committedAt: "2026-01-01T00:00:00.000Z" }),
        caller: SESSION_CALLER.BOT,
      },
      scopedMetadata: null,
      initialTurn: null,
    });
  }
  return {
    base,
    root,
    treeFile: path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE),
    backupBase: path.join(base, "backup"),
    write,
    publish,
  };
}

function node(sessionId, parentSessionId = "") {
  return { sessionId, parentSessionId, caller: SESSION_CALLER.BOT };
}

for (const marker of ["head.json", "immutable-session.format"]) {
  test(`discovery and retirement respect storage boundaries for ${marker}`, async (t) => {
    const { base, root, write, publish } = await fixture(t);
    await publish("active");
    await publish("active", "child");
    await write(`legacy/${marker}`);
    await write("legacy/objects/trap/session.json");
    await write("legacy/staging/trap/session.json");
    await write("legacy/turns/trap/session.json");
    await write("legacy/execution-events/trap/session.json");
    const activeTraps = Object.values(PARTITION_JOURNAL_DIRECTORIES).map(
      (name) => `active/${name}/trap/session.json`,
    );
    activeTraps.push("s.repair-staging-123/session.json", "s.repair-backup-123/session.json");
    activeTraps.push("s.mutation-lock/session.json");
    for (const file of activeTraps) await write(file);
    const discovered = [];
    for await (const entry of discoverSessionDirectories(base, [WORKSPACE_LAYOUT.SESSION_DIR])) {
      assert.equal(entry.error, null);
      discovered.push([path.relative(root, entry.sessionDir), entry.authority]);
    }
    assert.deepEqual(discovered.sort(), [
      ["active", "partition"],
      [path.join("active", "child"), "partition"],
      ["legacy", "immutable"],
    ]);
    const { quarantined } = await retireUnsupportedSessionStorage({ base, scopedSessionRoots: [] });
    assert.equal(quarantined.length, 1);
    await assert.rejects(readFile(path.join(root, "legacy", marker)), { code: "ENOENT" });
    for (const file of activeTraps)
      assert.equal(await readFile(path.join(root, file), "utf8"), "{}");
  });
}

test("missing tree is rebuilt from published placement without inventing a backup", async (t) => {
  const { base, treeFile, backupBase, publish } = await fixture(t);
  await publish("parent");
  await publish("parent", "child");
  const result = await ensureSessionTree({ base, backupBase });
  assert.equal(result.action, "rebuilt");
  assert.equal(result.backupPath, null);
  await assert.rejects(readdir(backupBase), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    parent: node("parent"),
    child: node("child", "parent"),
  });
  assert.equal(await ensureSessionTree({ base, backupBase }), null);
});

test("duplicate published identities reject rebuild without changing either authority", async (t) => {
  const { base, root, treeFile, backupBase, publish } = await fixture(t);
  await publish("parent");
  await publish("parent", "child");
  await publish("child");
  const original = Buffer.from([0x7b, 0xff]);
  await writeFile(treeFile, original);
  const markers = [
    path.join(root, "child", "CURRENT"),
    path.join(root, "parent", "child", "CURRENT"),
  ];
  const heads = await Promise.all(markers.map((file) => readFile(file)));
  await assert.rejects(rebuildStoredSessionTree({ base, backupBase }), {
    code: "SESSION_STORAGE_CORRUPT",
    message: /ambiguous session identities/,
  });
  assert.deepEqual(await readFile(treeFile), original);
  assert.deepEqual(await Promise.all(markers.map((file) => readFile(file))), heads);
  await assert.rejects(readdir(backupBase), { code: "ENOENT" });
});

for (const boundary of ["rename", "directory sync"]) {
  test(
    `tree rebuild resumes after failed publication ${boundary}`,
    { skip: boundary === "directory sync" && process.platform === "win32" },
    async (t) => {
      const { base, treeFile, backupBase, publish } = await fixture(t);
      const original = Buffer.from([0x7b, 0xff]);
      await publish("parent");
      await writeFile(treeFile, original);
      const adapter = getFsAdapter();
      const failure = Object.assign(new Error(`injected tree ${boundary} failure`), {
        code: "EIO",
      });
      let renamed = false;
      setFsAdapter({
        ...adapter,
        async rename(from, to) {
          if (to === treeFile && boundary === "rename") throw failure;
          await adapter.rename(from, to);
          if (to === treeFile) renamed = true;
        },
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          if (renamed && file === path.dirname(treeFile))
            handle.sync = async () => {
              throw failure;
            };
          return handle;
        },
      });
      try {
        await assert.rejects(
          rebuildStoredSessionTree({ base, backupBase }),
          (error) => error === failure,
        );
      } finally {
        setFsAdapter(adapter);
      }
      const plan = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_UPGRADE_FILE);
      assert.equal((await readFile(treeFile)).equals(original), boundary === "rename");
      await readFile(plan);
      const retryBackup = path.join(base, "retry");
      const result = await ensureSessionTree({ base, backupBase: retryBackup });
      assert.equal(result.backupPath, path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE));
      assert.deepEqual(await readFile(result.backupPath), original);
      assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
        parent: node("parent"),
      });
      await assert.rejects(readFile(plan), { code: "ENOENT" });
      await assert.rejects(readdir(retryBackup), { code: "ENOENT" });
      assert.equal(await ensureSessionTree({ base, backupBase: retryBackup }), null);
    },
  );
}

for (const conflict of [false, true]) {
  test(`tree rebuild leaves prior bytes intact on ${conflict ? "mixed authorities" : "unsupported authority"}`, async (t) => {
    const { base, treeFile, backupBase, write } = await fixture(t);
    await write("parent/head.json");
    if (conflict) await write("parent/CURRENT");
    await writeFile(treeFile, "{invalid");
    await assert.rejects(rebuildStoredSessionTree({ base, backupBase }), {
      code: conflict ? "SESSION_STORAGE_CORRUPT" : "SESSION_STORAGE_FORMAT_UNSUPPORTED",
    });
    assert.equal(await readFile(treeFile, "utf8"), "{invalid");
  });
}
