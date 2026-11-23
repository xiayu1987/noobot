/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { PARTITION_JOURNAL_DIRECTORIES } from "@noobot/session-protocol/partition-journal";
import { walkSessionManifestDirectories } from "../src/workspace-lifecycle/session-directory-walk.js";
import {
  ensureSessionTree,
  upgradeSessionStorage,
} from "../src/workspace-lifecycle/session-storage-upgrade.js";
import { immutableSessionReaderAccess } from "../src/session/session-artifact-session/immutable-reader-access.js";
import { PartitionJournalOwner } from "../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../src/session/partition-storage/partition-reader-access.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { journalTestLimits } from "./helpers/partition-journal-cases.js";
import { emptyPartitionSession } from "./helpers/partition-session-cases.js";

async function fixture(context) {
  const base = await mkdtemp(path.join(tmpdir(), "session-discovery-"));
  context.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  await mkdir(root, { recursive: true });
  async function write(relative, content = "{}") {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { base, root, write };
}

async function discover(root, options) {
  const result = [];
  for await (const directory of walkSessionManifestDirectories(root, options))
    result.push(path.relative(root, directory));
  return result.sort();
}

for (const marker of ["head.json", "immutable-session.format"]) {
  test(`discovery respects ${marker}, internal directories and nested sessions`, async (context) => {
    const { root, write } = await fixture(context);
    await write(`parent/${marker}`);
    await write("parent/session.json");
    await write("parent/child/session.json");
    for (const internal of ["objects/aa", "staging", "turns", "execution-events"])
      await write(`parent/${internal}/trap/session.json`);
    for (const internal of ["s.repair-staging-123", "s.repair-backup-123", "s.mutation-lock"])
      await write(`${internal}/session.json`);

    await write("objects/session.json");
    await write("staging/session.json");
    assert.deepEqual(await discover(root), ["objects", "parent/child", "staging"]);
    assert.deepEqual(await discover(root, { includeImmutable: true }), [
      "objects",
      "parent",
      "parent/child",
      "staging",
    ]);
  });
}

test("legacy artifact retirement cannot enter immutable data or repair workspaces", async (context) => {
  const { base, root, write } = await fixture(context);
  await createPublishedSession(immutableSessionReaderAccess, root, ["parent"]);
  const traps = [
    "parent/objects/aa/trap",
    "parent/staging/trap",
    "s.repair-staging-123",
    "s.repair-backup-123",
  ];
  const sessions = ["parent", "parent/child", "objects"];
  for (const directory of [...traps, ...sessions])
    await write(`${directory}/execution-events/index.json`, '{"schemaVersion":1}');
  let processed = 0;
  const result = await upgradeSessionStorage({
    base,
    backupBase: path.join(base, "backup"),
    scopedSessionRoots: ["runtime/scoped-session"],
    onSessionProcessed: () => {
      processed += 1;
    },
  });
  assert.equal(processed, sessions.length);
  assert.equal(result.retired.length, sessions.length);
  for (const directory of traps)
    assert.equal(
      await readFile(path.join(root, directory, "execution-events/index.json"), "utf8"),
      '{"schemaVersion":1}',
    );
  for (const directory of sessions)
    await assert.rejects(readFile(path.join(root, directory, "execution-events/index.json")), {
      code: "ENOENT",
    });
});

async function createPublishedSession(access, root, segments) {
  const scope = {
    sessionDir: path.join(root, ...segments),
    sessionId: segments.at(-1),
    parentSessionId: segments.length > 1 ? segments.at(-2) : "",
  };
  await access.create(scope, {
    operationId: "create",
    session: {
      ...emptyPartitionSession({ ...scope, committedAt: "2026-01-01T00:00:00.000Z" }),
      caller: SESSION_CALLER.BOT,
    },
    scopedMetadata: null,
    initialTurn: null,
  });
}

test("tree rebuilding cannot retire internal objects or repair workspace sessions", async (context) => {
  const { base, root, write } = await fixture(context);
  const document = (sessionId, parentSessionId) =>
    JSON.stringify({ sessionId, parentSessionId, caller: SESSION_CALLER.USER });
  await createPublishedSession(immutableSessionReaderAccess, root, ["parent"]);
  await write("parent/child/session.json", document("child", "parent"));
  const traps = ["parent/objects/aa/trap", "parent/staging/trap", "s.repair-staging-123"];
  for (const directory of traps) await write(`${directory}/session.json`, document("trap", ""));
  await writeFile(path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE), "{invalid");
  const result = await upgradeSessionStorage({
    base,
    backupBase: path.join(base, "backup"),
    scopedSessionRoots: ["runtime/scoped-session"],
  });
  assert.equal(result.sessionTree.nodes, 2);
  assert.deepEqual(result.sessionTree.rejected, []);
  assert.deepEqual(result.sessionTree.retiredSessions, []);
  for (const directory of traps)
    assert.equal(
      await readFile(path.join(root, directory, "session.json"), "utf8"),
      document("trap", ""),
    );
});

test("cold tree rebuilding uses partition placement and legacy retirement skips partition data", async (context) => {
  const { base, root, write } = await fixture(context);
  {
    await using owner = new PartitionJournalOwner({
      durableAncestor: base,
      limits: journalTestLimits(),
      maxJournals: 1,
    });
    await createPublishedSession(
      createPartitionSessionReaderAccess({
        acquireJournal: owner.acquire.bind(owner),
        withJournalRemoval: owner.withRemoval.bind(owner),
      }),
      root,
      ["parent"],
    );
  }
  await write(
    "parent/child/session.json",
    JSON.stringify({ sessionId: "child", parentSessionId: "parent", caller: SESSION_CALLER.USER }),
  );
  const artifact = "execution-events/index.json";
  const retiredContent = '{"schemaVersion":1}';
  await write(`parent/${artifact}`, retiredContent);
  await write(`parent/child/${artifact}`, retiredContent);
  for (const name of Object.values(PARTITION_JOURNAL_DIRECTORIES)) {
    await write(`parent/${name}/trap/session.json`);
    await write(`parent/${name}/trap/${artifact}`, retiredContent);
  }
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  await writeFile(treeFile, "{invalid");
  assert.deepEqual(await discover(root, { includeImmutable: true }), ["parent/child"]);
  const result = await upgradeSessionStorage({
    base,
    backupBase: path.join(base, "backup"),
    scopedSessionRoots: ["runtime/scoped-session"],
  });
  assert.equal(result.retired.length, 1);
  assert.deepEqual(result.sessionTree.retiredSessions, []);
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    parent: { sessionId: "parent", parentSessionId: "", caller: SESSION_CALLER.BOT },
    child: { sessionId: "child", parentSessionId: "parent", caller: SESSION_CALLER.USER },
  });
  await assert.rejects(readFile(path.join(root, "parent/child", artifact)), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "parent", artifact), "utf8"), retiredContent);
  for (const name of Object.values(PARTITION_JOURNAL_DIRECTORIES))
    assert.equal(
      await readFile(path.join(root, "parent", name, "trap", artifact), "utf8"),
      retiredContent,
    );
});

test("a legacy tree cannot retire an ancestor that contains an omitted published session", async (context) => {
  const { base, root, write } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const tree = '{"roots":[],"nodes":{}}';
  await writeFile(treeFile, tree);
  await write("parent/session.json", '{"sessionId":"parent","parentSessionId":""}');
  const childDir = path.join(root, "parent", "child");
  const marker = path.join(childDir, "CURRENT");
  const openOwner = () =>
    new PartitionJournalOwner({
      durableAncestor: base,
      limits: journalTestLimits(),
      maxJournals: 1,
    });
  {
    await using owner = openOwner();
    const access = createPartitionSessionReaderAccess({
      acquireJournal: owner.acquire.bind(owner),
      withJournalRemoval: owner.withRemoval.bind(owner),
    });
    await createPublishedSession(access, root, ["parent", "child"]);
  }
  const head = await readFile(marker);
  const backupBase = path.join(base, "backup");
  await assert.rejects(
    upgradeSessionStorage({ base, backupBase, scopedSessionRoots: ["runtime/scoped-session"] }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
  assert.equal(await readFile(treeFile, "utf8"), tree);
  assert.deepEqual(await readFile(marker), head);
  await assert.rejects(readFile(path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE)), {
    code: "ENOENT",
  });
  await using owner = openOwner();
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  assert.deepEqual(await access.readPlacement({ sessionDir: childDir, sessionId: "child" }), {
    sessionId: "child",
    parentSessionId: "parent",
    caller: SESSION_CALLER.BOT,
  });
});

test("tree rebuild rejects duplicate identities before retiring either directory", async (context) => {
  const { base, root, write } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const session = (sessionId, parentSessionId) =>
    JSON.stringify({ sessionId, parentSessionId, caller: SESSION_CALLER.USER });
  const files = {
    "parent/session.json": session("parent", ""),
    "parent/child/session.json": session("child", "parent"),
    "child/session.json": session("child", ""),
  };
  for (const [file, content] of Object.entries(files)) await write(file, content);
  const original = "{invalid";
  await writeFile(treeFile, original);
  const backupBase = path.join(base, "backup");
  await assert.rejects(
    upgradeSessionStorage({ base, backupBase, scopedSessionRoots: ["runtime/scoped-session"] }),
    {
      code: "SESSION_STORAGE_CORRUPT",
      message: /ambiguous session identities/,
    },
  );
  assert.equal(await readFile(treeFile, "utf8"), original);
  for (const [file, content] of Object.entries(files))
    assert.equal(await readFile(path.join(root, file), "utf8"), content);
  await assert.rejects(readFile(path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE)), {
    code: "ENOENT",
  });
});

test("tree upgrade retries after partial retirement without losing the original tree", async (context) => {
  const { base, root, write } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const original = Buffer.from([0x7b, 0xff]);
  await writeFile(treeFile, original);
  await write("first/session.json");
  await write("parent/session.json", '{"sessionId":"parent","parentSessionId":"","caller":"user"}');
  await write("parent/second/session.json");
  const backupBase = path.join(base, "backup");
  const backupTree = path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const retiredRoot = path.join(backupBase, WORKSPACE_LAYOUT.SESSION_DIR);
  const blocked = path.join(retiredRoot, "parent", "second");
  await mkdir(blocked, { recursive: true });
  await writeFile(path.join(blocked, "obstruction"), "");
  const upgrade = () =>
    upgradeSessionStorage({ base, backupBase, scopedSessionRoots: ["runtime/scoped-session"] });

  await assert.rejects(upgrade(), { code: /^(?:ENOTEMPTY|EEXIST|EPERM)$/ });
  assert.deepEqual(await readFile(treeFile), original);
  assert.deepEqual(await readFile(backupTree), original);
  assert.equal(await readFile(path.join(retiredRoot, "first", "session.json"), "utf8"), "{}");
  assert.equal(await readFile(path.join(root, "parent", "second", "session.json"), "utf8"), "{}");

  await rm(blocked, { recursive: true });
  const result = await upgrade();
  assert.equal(result.sessionTree.nodes, 1);
  assert.deepEqual(await readFile(backupTree), original);
  assert.equal(await readFile(path.join(blocked, "session.json"), "utf8"), "{}");
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    parent: { sessionId: "parent", parentSessionId: "", caller: SESSION_CALLER.USER },
  });
  assert.equal((await upgrade()).sessionTree, null);
});

test("a missing tree is rebuilt from published placement without an invented backup", async (context) => {
  const { base, root } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const backupBase = path.join(base, "backup");
  const upgrade = () =>
    upgradeSessionStorage({ base, backupBase, scopedSessionRoots: ["runtime/scoped-session"] });
  assert.equal((await upgrade()).sessionTree, null);
  await assert.rejects(readFile(treeFile), { code: "ENOENT" });
  await createPublishedSession(immutableSessionReaderAccess, root, ["parent"]);
  await createPublishedSession(immutableSessionReaderAccess, root, ["parent", "child"]);
  const { sessionTree } = await upgrade();
  assert.equal(sessionTree.action, "rebuilt");
  assert.equal(sessionTree.backupPath, null);
  await assert.rejects(readFile(path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE)), {
    code: "ENOENT",
  });
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    parent: { sessionId: "parent", parentSessionId: "", caller: SESSION_CALLER.BOT },
    child: { sessionId: "child", parentSessionId: "parent", caller: SESSION_CALLER.BOT },
  });
  assert.equal((await upgrade()).sessionTree, null);
});

test("a legacy tree cannot publish a missing repository or a child through a missing repository", async (context) => {
  const { base, write } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const original = JSON.stringify({
    nodes: {
      present: { parentSessionId: "" },
      absent: { parentSessionId: "" },
      child: { parentSessionId: "absent" },
    },
  });
  await writeFile(treeFile, original);
  await write(
    "present/session.json",
    '{"sessionId":"present","parentSessionId":"","caller":"user"}',
  );
  await write(
    "absent/child/session.json",
    '{"sessionId":"child","parentSessionId":"absent","caller":"bot"}',
  );
  const { sessionTree } = await upgradeSessionStorage({
    base,
    backupBase: path.join(base, "backup"),
    scopedSessionRoots: ["runtime/scoped-session"],
  });
  assert.deepEqual(sessionTree.rejected, [
    { sessionId: "absent", reason: "repository-missing" },
    { sessionId: "child", reason: "parent-rejected" },
  ]);
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    present: { sessionId: "present", parentSessionId: "", caller: SESSION_CALLER.USER },
  });
  assert.equal(await readFile(sessionTree.backupPath, "utf8"), original);
});

test("a failed final tree rename preserves the old tree and permits retry after retirement", async (context) => {
  const { base, write } = await fixture(context);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const original = Buffer.from([0x7b, 0xff]);
  const backupBase = path.join(base, "backup");
  const backupTree = path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const retired = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "rejected", "session.json");
  await writeFile(treeFile, original);
  await write("rejected/session.json");
  await write("parent/session.json", '{"sessionId":"parent","parentSessionId":"","caller":"user"}');
  const upgrade = () =>
    upgradeSessionStorage({ base, backupBase, scopedSessionRoots: ["runtime/scoped-session"] });
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("injected final tree rename failure"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    rename: async (from, to) => {
      if (to === treeFile) throw failure;
      return adapter.rename(from, to);
    },
  });
  try {
    await assert.rejects(upgrade(), (error) => error === failure);
  } finally {
    setFsAdapter(adapter);
  }
  assert.deepEqual(await readFile(treeFile), original);
  assert.deepEqual(await readFile(backupTree), original);
  assert.equal(await readFile(path.join(backupBase, retired), "utf8"), "{}");
  await assert.rejects(readFile(path.join(base, retired)), { code: "ENOENT" });
  assert.equal(
    (await readdir(path.dirname(treeFile))).some((name) => name.startsWith(".noobot-atomic-")),
    false,
  );
  assert.equal((await upgrade()).sessionTree.nodes, 1);
  assert.deepEqual(await readFile(backupTree), original);
  assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
    parent: { sessionId: "parent", parentSessionId: "", caller: SESSION_CALLER.USER },
  });
});

for (const boundary of ["retirement destination", "retirement source", "tree publication"]) {
  test(
    `tree recovery replays a failed ${boundary} sync`,
    { skip: process.platform === "win32" },
    async (context) => {
      const { base, root, write } = await fixture(context);
      const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
      const planFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_UPGRADE_FILE);
      const backupBase = path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, "first");
      const nextBackup = path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, "retry");
      const backupRoot = path.join(backupBase, WORKSPACE_LAYOUT.SESSION_DIR);
      const retired = path.join(backupRoot, "rejected");
      const original = Buffer.from([0x7b, 0xff]);
      await writeFile(treeFile, original);
      await write("rejected/session.json");
      await write(
        "parent/session.json",
        '{"sessionId":"parent","parentSessionId":"","caller":"user"}',
      );
      const adapter = getFsAdapter();
      const failure = Object.assign(new Error(`injected ${boundary} sync failure`), {
        code: "EIO",
      });
      const publishFailure = boundary === "tree publication";
      const syncDirectory = boundary === "retirement destination" ? backupRoot : root;
      let armed = false;
      setFsAdapter({
        ...adapter,
        async rename(from, to) {
          await adapter.rename(from, to);
          if (to === (publishFailure ? treeFile : retired)) armed = true;
        },
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          if (armed && file === syncDirectory)
            handle.sync = async () => {
              throw failure;
            };
          return handle;
        },
      });
      try {
        await assert.rejects(
          upgradeSessionStorage({
            base,
            backupBase,
            scopedSessionRoots: ["runtime/scoped-session"],
          }),
          (error) => error === failure,
        );
      } finally {
        setFsAdapter(adapter);
      }

      assert.equal((await readFile(treeFile)).equals(original), !publishFailure);
      await readFile(planFile);
      await assert.rejects(readFile(path.join(root, "rejected", "session.json")), {
        code: "ENOENT",
      });
      const recovered = await ensureSessionTree({ base, backupBase: nextBackup });
      assert.equal(recovered.backupPath, path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE));
      assert.deepEqual(await readFile(recovered.backupPath), original);
      assert.equal(await readFile(path.join(retired, "session.json"), "utf8"), "{}");
      assert.deepEqual(JSON.parse(await readFile(treeFile, "utf8")).nodes, {
        parent: { sessionId: "parent", parentSessionId: "", caller: SESSION_CALLER.USER },
      });
      await assert.rejects(readFile(planFile), { code: "ENOENT" });
      await assert.rejects(readdir(nextBackup), { code: "ENOENT" });
      assert.equal(await ensureSessionTree({ base, backupBase: nextBackup }), null);
    },
  );
}

for (const conflict of [false, true]) {
  test(`tree rebuilding leaves the old tree intact on ${conflict ? "conflicting authorities" : "a corrupt immutable head"}`, async (context) => {
    const { base, root, write } = await fixture(context);
    await write("parent/head.json");
    if (conflict) {
      await write("parent/CURRENT");
      await assert.rejects(discover(root), { code: "SESSION_STORAGE_CORRUPT" });
    }
    const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    await writeFile(treeFile, "{invalid");
    await assert.rejects(
      upgradeSessionStorage({
        base,
        backupBase: path.join(base, "backup"),
        scopedSessionRoots: ["runtime/scoped-session"],
      }),
      {
        code: conflict ? "SESSION_STORAGE_CORRUPT" : "SESSION_IMMUTABLE_STORAGE_INVALID",
      },
    );
    assert.equal(await readFile(treeFile, "utf8"), "{invalid");
  });
}
