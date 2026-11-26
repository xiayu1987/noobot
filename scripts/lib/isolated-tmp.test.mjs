/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RUNTIME_INSTANCE_PATH_ENV_KEYS } from "@noobot/runtime-topology-protocol/instance-paths";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import {
  ISOLATED_TMP_ENV,
  acquireIsolatedTmpDir,
  buildIsolatedTmpEnv,
  pruneOldest,
} from "./isolated-tmp.mjs";

function createRoot(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "noobot-isolated-tmp-spec-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createAgedDir(root, name, ageMs) {
  const dir = path.join(root, name);
  mkdirSync(dir);
  const time = new Date(Date.now() - ageMs);
  utimesSync(dir, time, time);
  return dir;
}

const HOUR_MS = 60 * 60 * 1000;

test("acquireIsolatedTmpDir reuses inherited dir without creating or pruning", async (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-old", 5 * HOUR_MS);
  const result = await acquireIsolatedTmpDir({
    prefix: "p-",
    keep: 1,
    tmpRoot: root,
    env: { [ISOLATED_TMP_ENV]: "/outer/dir" },
  });
  assert.deepEqual(result, { dir: "/outer/dir", created: false });
  assert.deepEqual(readdirSync(root), ["p-old"]);
});

test("acquireIsolatedTmpDir keeps recent dirs and prunes only old ones beyond keep", async (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-a", 5 * HOUR_MS);
  createAgedDir(root, "p-b", 4 * HOUR_MS);
  createAgedDir(root, "p-c", 1000);
  createAgedDir(root, "other", 9 * HOUR_MS);
  const result = await acquireIsolatedTmpDir({ prefix: "p-", keep: 2, tmpRoot: root, env: {} });
  assert.equal(result.created, true);
  assert.equal(path.dirname(result.dir), root);
  const names = readdirSync(root).sort();
  assert.deepEqual(names, [".noobot-prune.lock", "other", "p-c", path.basename(result.dir)].sort());
});

test("pruneOldest never removes dirs younger than minAgeMs", async (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-a", 2000);
  createAgedDir(root, "p-b", 1000);
  await pruneOldest(root, (name) => name.startsWith("p-"), 0, { minAgeMs: HOUR_MS });
  assert.deepEqual(readdirSync(root).sort(), [".noobot-prune.lock", "p-a", "p-b"]);
  await pruneOldest(root, (name) => name.startsWith("p-"), 0);
  assert.deepEqual(readdirSync(root), [".noobot-prune.lock"]);
});

test("pruneOldest excludes other owners from pruning and retention counts", async (t) => {
  const root = createRoot(t);
  const owned = createAgedDir(root, "p-owned", 5 * HOUR_MS);
  const uid = statSync(owned).uid;
  t.mock.method(os, "userInfo", () => ({ uid: uid + 1 }));
  await pruneOldest(root, (name) => name.startsWith("p-"), 0);
  assert.deepEqual(readdirSync(root), [".noobot-prune.lock", "p-owned"]);
});

test("pruneOldest excludes symbolic links and surfaces filesystem errors", async (t) => {
  const root = createRoot(t);
  const target = createAgedDir(root, "target", 5 * HOUR_MS);
  symlinkSync(target, path.join(root, "p-link"), "junction");
  await pruneOldest(root, (name) => name.startsWith("p-"), 0);
  assert.deepEqual(readdirSync(root).sort(), [".noobot-prune.lock", "p-link", "target"]);
  await assert.rejects(
    pruneOldest(path.join(root, "missing"), () => true, 0),
    {
      code: "ENOENT",
    },
  );
});

test("pruneOldest coordinates real child processes on the same directory", async (t) => {
  const root = createRoot(t);
  const target = createAgedDir(root, "p-shared", 5 * HOUR_MS);
  for (let index = 0; index < 100; index++)
    writeFileSync(path.join(target, `file-${index}`), "content");
  const source = `import { pruneOldest } from ${JSON.stringify(new URL("./isolated-tmp.mjs", import.meta.url).href)};
    await pruneOldest(process.argv[1], () => true, 0);`;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", source, root]),
    ),
  );
  assert.deepEqual(readdirSync(root), [".noobot-prune.lock"]);
});

test("pruneOldest acquires ownership after a lock holder exits without closing", async (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-old", 5 * HOUR_MS);
  const source = `import { open } from 'node:fs/promises';
    import { tryAcquireDescriptorLock } from '@noobot/platform-compatibility/descriptor-lock';
    const handle = await open(process.argv[1], 'a+');
    if (!await tryAcquireDescriptorLock(handle)) process.exit(2);
    process.exit(0);`;
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    source,
    path.join(root, ".noobot-prune.lock"),
  ]);
  await pruneOldest(root, () => true, 0);
  assert.deepEqual(readdirSync(root), [".noobot-prune.lock"]);
});

test("buildIsolatedTmpEnv points all tmp variables and marker at dir", () => {
  const env = buildIsolatedTmpEnv("/x", { KEEP: "1" });
  assert.deepEqual(env, {
    KEEP: "1",
    [ISOLATED_TMP_ENV]: "/x",
    [WORKSPACE_ROOT_ENV]: path.join("/x", "workspace"),
    TMPDIR: "/x",
    TMP: "/x",
    TEMP: "/x",
  });
});

test("buildIsolatedTmpEnv drops inherited runtime instance paths and isolates workspace root", () => {
  const inherited = Object.fromEntries(
    RUNTIME_INSTANCE_PATH_ENV_KEYS.map((key) => [key, `/real/${key}`]),
  );
  const env = buildIsolatedTmpEnv("/x", { KEEP: "1", ...inherited });
  for (const key of RUNTIME_INSTANCE_PATH_ENV_KEYS) {
    if (key === WORKSPACE_ROOT_ENV) continue;
    assert.equal(Object.hasOwn(env, key), false);
  }
  assert.equal(env[WORKSPACE_ROOT_ENV], path.join("/x", "workspace"));
  assert.equal(env.KEEP, "1");
  assert.equal(env.TMPDIR, "/x");
});

test("Node test workers isolate default workspaces and retain them in descendant processes", async (t) => {
  const root = createRoot(t);
  const bootstrap = new URL("./isolated-node-runtime.mjs", import.meta.url).href;
  const source = `import { execFileSync } from 'node:child_process';
    import { mkdirSync, writeFileSync } from 'node:fs';
    import test from 'node:test';
    test('workspace ownership', () => {
      const workspace = process.env[${JSON.stringify(WORKSPACE_ROOT_ENV)}];
      mkdirSync(workspace, { recursive: true });
      writeFileSync(workspace + '/owner', process.argv[1], { flag: 'wx' });
      const inherited = execFileSync(process.execPath,
        ['--import', ${JSON.stringify(bootstrap)}, '-e',
          'process.stdout.write(process.env[${JSON.stringify(WORKSPACE_ROOT_ENV)}])'],
        { encoding: 'utf8' });
      if (inherited !== workspace) throw new Error('descendant lost workspace ownership');
      writeFileSync(process.argv[1] + '.json', JSON.stringify({ workspace, inherited }));
    });`;
  const files = ["first.test.mjs", "second.test.mjs"].map((name) => path.join(root, name));
  for (const file of files) writeFileSync(file, source);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NOOBOT_TEST_WORKSPACE_INITIALIZED;
  await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("../run-with-isolated-tmp.mjs", import.meta.url)),
      "node",
      "--test",
      "--test-concurrency=2",
      ...files,
    ],
    { env: buildIsolatedTmpEnv(root, env) },
  );
  const results = files.map((file) => JSON.parse(readFileSync(file + ".json", "utf8")));
  assert.notEqual(results[0].workspace, results[1].workspace);
  for (const { workspace, inherited } of results) {
    assert.equal(inherited, workspace);
    assert.equal(path.dirname(path.dirname(workspace)), root);
  }
});
