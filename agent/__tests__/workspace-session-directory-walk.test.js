/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { walkSessionManifestDirectories } from "../src/workspace-lifecycle/session-directory-walk.js";
import { upgradeSessionStorage } from "../src/workspace-lifecycle/session-storage-upgrade.js";

async function fixture(context) {
  const base = await mkdtemp(path.join(tmpdir(), "session-discovery-"));
  context.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
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
  await write("parent/head.json");
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

test("tree rebuilding cannot retire internal objects or repair workspace sessions", async (context) => {
  const { base, root, write } = await fixture(context);
  const document = (sessionId, parentSessionId) =>
    JSON.stringify({ sessionId, parentSessionId, caller: SESSION_CALLER.USER });
  await write("parent/session.json", document("parent", ""));
  await write("parent/head.json");
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
