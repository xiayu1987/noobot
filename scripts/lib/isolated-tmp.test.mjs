/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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

test("acquireIsolatedTmpDir reuses inherited dir without creating or pruning", (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-old", 5 * HOUR_MS);
  const result = acquireIsolatedTmpDir({
    prefix: "p-",
    keep: 1,
    tmpRoot: root,
    env: { [ISOLATED_TMP_ENV]: "/outer/dir" },
  });
  assert.deepEqual(result, { dir: "/outer/dir", created: false });
  assert.deepEqual(readdirSync(root), ["p-old"]);
});

test("acquireIsolatedTmpDir keeps recent dirs and prunes only old ones beyond keep", (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-a", 5 * HOUR_MS);
  createAgedDir(root, "p-b", 4 * HOUR_MS);
  createAgedDir(root, "p-c", 1000);
  createAgedDir(root, "other", 9 * HOUR_MS);
  const result = acquireIsolatedTmpDir({ prefix: "p-", keep: 2, tmpRoot: root, env: {} });
  assert.equal(result.created, true);
  assert.equal(path.dirname(result.dir), root);
  const names = readdirSync(root).sort();
  assert.deepEqual(names, ["other", "p-c", path.basename(result.dir)].sort());
});

test("pruneOldest never removes dirs younger than minAgeMs", (t) => {
  const root = createRoot(t);
  createAgedDir(root, "p-a", 2000);
  createAgedDir(root, "p-b", 1000);
  pruneOldest(root, (name) => name.startsWith("p-"), 0, { minAgeMs: HOUR_MS });
  assert.deepEqual(readdirSync(root).sort(), ["p-a", "p-b"]);
  pruneOldest(root, (name) => name.startsWith("p-"), 0);
  assert.deepEqual(readdirSync(root), []);
});

test("buildIsolatedTmpEnv points all tmp variables and marker at dir", () => {
  const env = buildIsolatedTmpEnv("/x", { KEEP: "1" });
  assert.deepEqual(env, {
    KEEP: "1",
    [ISOLATED_TMP_ENV]: "/x",
    TMPDIR: "/x",
    TMP: "/x",
    TEMP: "/x",
  });
});
