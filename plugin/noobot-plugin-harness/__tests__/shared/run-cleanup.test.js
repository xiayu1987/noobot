/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { createRunPaths } from "../../src/core/context.js";

import { cleanupOldRuns, cleanupRunsBySessionIds } from "../../src/utils/cleanup.js";
import { HARNESS_FILES, resolveHarnessRunsRelativePath } from "../../src/core/constants.js";
import {
  appendJsonlBuffered,
  flushAllJsonlBuffers,
  flushAllManifests,
  initializeRun,
  readJson,
  updateManifestCached,
  writeJson,
} from "../../src/store/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPTIONS = Object.freeze({ maxRuns: 100, maxRunAgeDays: 30, cleanupGraceMs: 60000 });

async function createBase(t) {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "harness-cleanup-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  return basePath;
}

async function createRun(
  basePath,
  runId,
  { ageMs = 0, manifest = { sessionId: "unrelated" } } = {},
) {
  const runDir = path.join(basePath, resolveHarnessRunsRelativePath(), runId);
  await fs.mkdir(runDir, { recursive: true });
  const at = new Date(Date.now() - ageMs);
  if (manifest) {
    const manifestPath = path.join(runDir, HARNESS_FILES.RUN_MANIFEST);
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await fs.utimes(manifestPath, at, at);
  }
  await fs.utimes(runDir, at, at);
  return runDir;
}

async function listRuns(basePath) {
  return (await fs.readdir(path.join(basePath, resolveHarnessRunsRelativePath()))).sort();
}

test("cleanupOldRuns returns zero counters when the runs directory is absent", async (t) => {
  const basePath = await createBase(t);
  assert.deepEqual(await cleanupOldRuns(basePath, OPTIONS), {
    deleted: 0,
    errors: 0,
  });
});

for (const blockedParent of [false, true]) {
  test(`run cleanup rejects a file blocking the ${blockedParent ? "parent" : "runs directory"}`, async (t) => {
    const basePath = await createBase(t);
    const runs = path.join(basePath, resolveHarnessRunsRelativePath());
    const blocked = blockedParent ? path.dirname(runs) : runs;
    await fs.mkdir(path.dirname(blocked), { recursive: true });
    await fs.writeFile(blocked, "preserve structural failure");
    for (const cleanup of [
      () => cleanupOldRuns(basePath, OPTIONS),
      () => cleanupRunsBySessionIds(basePath, ["s1"]),
    ]) {
      await assert.rejects(cleanup, (error) => ["ENOTDIR", "EEXIST"].includes(error.code));
      assert.equal(await fs.readFile(blocked, "utf8"), "preserve structural failure");
    }
  });
}

test("harness JSON reads reject structural failures instead of returning a fallback", async (t) => {
  const basePath = await createBase(t);
  const blocked = path.join(basePath, "blocked");
  await fs.writeFile(blocked, "preserve");
  await assert.rejects(readJson(path.join(blocked, "manifest.json"), {}), { code: "ENOTDIR" });
  assert.deepEqual(await readJson(path.join(basePath, "absent.json"), {}), {});
  assert.equal(await fs.readFile(blocked, "utf8"), "preserve");
});

test("run cleanup rejects non-directory entries without removing evidence", async (t) => {
  const basePath = await createBase(t);
  const runs = path.join(basePath, resolveHarnessRunsRelativePath());
  await fs.mkdir(runs, { recursive: true });
  const blocked = path.join(runs, "owned");
  await fs.writeFile(blocked, "preserve");
  await assert.rejects(cleanupOldRuns(basePath, OPTIONS), /harness run must be a directory/);
  await assert.rejects(
    cleanupRunsBySessionIds(basePath, ["s1"]),
    /harness run must be a directory/,
  );
  assert.equal(await fs.readFile(blocked, "utf8"), "preserve");
});

test("session cleanup preserves missing or invalid ownership evidence and retries after repair", async (t) => {
  const basePath = await createBase(t);
  const runDir = await createRun(basePath, "owned", { manifest: null });
  const manifestPath = path.join(runDir, HARNESS_FILES.RUN_MANIFEST);
  await assert.rejects(cleanupRunsBySessionIds(basePath, ["s1"]), { code: "ENOENT" });
  for (const manifest of [
    null,
    [],
    {},
    { parentSessionId: "s1" },
    { sessionId: "../bad" },
    { sessionId: "s1", parentSessionId: false },
    { sessionId: "s1", parentSessionId: " " },
  ]) {
    const raw = JSON.stringify(manifest);
    await fs.writeFile(manifestPath, raw);
    await assert.rejects(cleanupRunsBySessionIds(basePath, ["s1"]), /valid session ownership/);
    assert.equal(await fs.readFile(manifestPath, "utf8"), raw);
    assert.deepEqual(await listRuns(basePath), ["owned"]);
  }
  await fs.writeFile(manifestPath, JSON.stringify({ sessionId: "s1", parentSessionId: null }));
  assert.deepEqual(await cleanupRunsBySessionIds(basePath, ["s1"]), { deleted: 1, matchedRuns: 1 });
  assert.deepEqual(await listRuns(basePath), []);
});

test("cleanupOldRuns deletes runs older than the retention age", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "old", { ageMs: 40 * DAY_MS });
  await createRun(basePath, "fresh", { ageMs: DAY_MS });
  const result = await cleanupOldRuns(basePath, OPTIONS);
  assert.deepEqual(result, { deleted: 1, errors: 0 });
  assert.deepEqual(await listRuns(basePath), ["fresh"]);
});

test("cleanupOldRuns uses the run directory mtime when the manifest is not written yet", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "no-manifest-old", { ageMs: 40 * DAY_MS, manifest: null });
  await createRun(basePath, "no-manifest-fresh", { ageMs: DAY_MS, manifest: null });
  await cleanupOldRuns(basePath, OPTIONS);
  assert.deepEqual(await listRuns(basePath), ["no-manifest-fresh"]);
});

test("cleanupOldRuns trims the oldest runs beyond maxRuns", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "a", { ageMs: 3 * DAY_MS });
  await createRun(basePath, "b", { ageMs: 2 * DAY_MS });
  await createRun(basePath, "c", { ageMs: DAY_MS });
  const result = await cleanupOldRuns(basePath, { ...OPTIONS, maxRuns: 1 });
  assert.equal(result.deleted, 2);
  assert.deepEqual(await listRuns(basePath), ["c"]);
});

test("cleanupOldRuns keeps runs inside the grace window even beyond maxRuns", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "a", { ageMs: 1000 });
  await createRun(basePath, "b", { ageMs: 500 });
  const result = await cleanupOldRuns(basePath, { ...OPTIONS, maxRuns: 1 });
  assert.equal(result.deleted, 0);
  assert.deepEqual(await listRuns(basePath), ["a", "b"]);
});

test("cleanupRunsBySessionIds only matches manifest session ownership", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "s-direct");
  await createRun(basePath, "by-session", { manifest: { sessionId: "s1", parentSessionId: "" } });
  await createRun(basePath, "by-parent", {
    manifest: { sessionId: "child", parentSessionId: "s2" },
  });
  await createRun(basePath, "other", { manifest: { sessionId: "keep" } });
  const result = await cleanupRunsBySessionIds(basePath, ["s-direct", "s1", "s2", "s3"]);
  assert.deepEqual(result, { deleted: 2, matchedRuns: 2 });
  assert.deepEqual(await listRuns(basePath), ["other", "s-direct"]);
});

test("session cleanup replays partial removal after the run manifest is gone", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "owned", { manifest: { sessionId: "s1" } });
  const remove = fs.rm.bind(fs);
  const failure = Object.assign(new Error("cannot remove run"), { code: "EIO" });
  const fault = t.mock.method(fs, "rm", async (target, options) => {
    if (path.basename(target).startsWith(".session-deletion-")) {
      await fs.unlink(path.join(target, HARNESS_FILES.RUN_MANIFEST));
      throw failure;
    }
    return remove(target, options);
  });
  try {
    await assert.rejects(cleanupRunsBySessionIds(basePath, ["s1"]), (error) => error === failure);
    const [staged] = await listRuns(basePath);
    assert.match(staged, /^\.session-deletion-/);
    await cleanupOldRuns(basePath, { maxRuns: 1, maxRunAgeDays: 1, cleanupGraceMs: 1 });
    assert.deepEqual(await listRuns(basePath), [staged]);
  } finally {
    fault.mock.restore();
  }
  await cleanupRunsBySessionIds(basePath, ["s1"]);
  assert.deepEqual(await listRuns(basePath), []);
});

test("cleanupRunsBySessionIds rejects missing session ids", async (t) => {
  const basePath = await createBase(t);
  await assert.rejects(() => cleanupRunsBySessionIds(basePath, []), TypeError);
  await assert.rejects(() => cleanupRunsBySessionIds(basePath, "s1"), TypeError);
});

test("an existing root run with an empty parent session ID can be resumed", async (t) => {
  const basePath = await createBase(t);
  const ctx = { dialogProcessId: "existing", sessionId: "s1" };
  const run = createRunPaths(ctx, { basePath });
  await createRun(basePath, run.runId, { manifest: { sessionId: "s1", parentSessionId: "" } });

  await initializeRun(run);
  await updateManifestCached(
    run,
    ctx,
    {},
    {},
    null,
    (current) => ({ ...current, resumed: true }),
    0,
  );
  assert.equal((await readJson(run.manifest)).resumed, true);
});

async function markDeleted(basePath, sessionId) {
  const file = path.join(basePath, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ sessions: { [sessionId]: Date.now() } }));
}

test("run admission can retry after process exit before publication", async (t) => {
  const basePath = await createBase(t);
  const run = createRunPaths({ dialogProcessId: "interrupted", sessionId: "s1" }, { basePath });
  const runtime = new URL("../../../../shared/testing/runtime-params.js", import.meta.url).href;
  const store = new URL("../../src/store/store.js", import.meta.url).href;
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      "--import",
      runtime,
      "--input-type=module",
      "-e",
      `
      import fs from "node:fs/promises";
      import { initializeRun } from ${JSON.stringify(store)};
      const run = ${JSON.stringify(run)};
      const rename = fs.rename;
      fs.rename = async (source, destination) => {
        if (destination === run.runDir) process.exit(27);
        return rename(source, destination);
      };
      await initializeRun(run);
      `,
    ]),
    { code: 27 },
  );
  assert.deepEqual(await listRuns(basePath), []);
  await assert.rejects(writeJson(run, run.contextSnapshot, {}), { code: "HARNESS_RUN_NOT_FOUND" });
  await initializeRun(run);
  assert.deepEqual(await listRuns(basePath), [run.runId]);
  assert.deepEqual(JSON.parse(await fs.readFile(run.manifest, "utf8")), {
    sessionId: "s1",
    parentSessionId: null,
  });
});

test("cleanup waits for a writer in its publication window and rejects late writes", async (t) => {
  const basePath = await createBase(t);
  const run = createRunPaths({ dialogProcessId: "owned", sessionId: "s1" }, { basePath });
  await initializeRun(run);
  const rename = fs.rename.bind(fs);
  const writeEntered = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  let staged = false;
  t.mock.method(fs, "rename", async (source, destination) => {
    if (destination === run.contextSnapshot) {
      writeEntered.resolve();
      await releaseWrite.promise;
    }
    if (source === run.runDir) staged = true;
    return rename(source, destination);
  });
  const write = writeJson(run, run.contextSnapshot, { before: true });
  await Promise.race([writeEntered.promise, write]);
  const abort = new AbortController();
  try {
    await markDeleted(basePath, "s1");
    setTimeout(() => abort.abort(new Error("lock wait cancelled")), 30);
    await assert.rejects(
      cleanupRunsBySessionIds(basePath, ["s1"], { signal: abort.signal }),
      (error) => error === abort.signal.reason || error.cause === abort.signal.reason,
    );
    assert.equal(staged, false);
  } finally {
    releaseWrite.resolve();
    await write;
  }
  await cleanupRunsBySessionIds(basePath, ["s1"]);
  assert.equal(staged, true);
  await assert.rejects(writeJson(run, run.contextSnapshot, {}), { code: "SESSION_DELETED" });
  assert.deepEqual(await listRuns(basePath), []);
});

test("session deletion cancels delayed diagnostics and prevents a new process recreating the run", async (t) => {
  const basePath = await createBase(t);
  const ctx = { dialogProcessId: "owned", sessionId: "child", parentSessionId: "s1" };
  const run = createRunPaths(ctx, { basePath });
  const keep = createRunPaths({ dialogProcessId: "keep", sessionId: "keep" }, { basePath });
  const strategy = { maxSize: 100, maxTime: 60000 };
  await initializeRun(run);
  await initializeRun(keep);
  await appendJsonlBuffered(run, run.events, { id: 1 }, strategy);
  await appendJsonlBuffered(keep, keep.events, { id: 2 }, strategy);
  await updateManifestCached(
    run,
    ctx,
    {},
    {},
    null,
    (current) => ({ ...current, pending: true }),
    60000,
  );
  await markDeleted(basePath, "s1");
  await cleanupRunsBySessionIds(basePath, ["s1"]);
  await flushAllManifests();
  await flushAllJsonlBuffers();
  assert.match(await fs.readFile(keep.events, "utf8"), /"id":2/);
  const runtime = new URL("../../../../shared/testing/runtime-params.js", import.meta.url).href;
  const store = new URL("../../src/store/store.js", import.meta.url).href;
  await promisify(execFile)(process.execPath, [
    "--import",
    runtime,
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    import { writeJson } from ${JSON.stringify(store)};
    const run = ${JSON.stringify(run)};
    await assert.rejects(writeJson(run, run.contextSnapshot, {}), { code: "SESSION_DELETED" });
  `,
  ]);
  assert.deepEqual(await listRuns(basePath), ["keep"]);
});

test("a write queued behind retention cannot recreate the removed run", async (t) => {
  const basePath = await createBase(t);
  const run = createRunPaths({ dialogProcessId: "expired", sessionId: "s1" }, { basePath });
  await assert.rejects(writeJson(run, run.contextSnapshot, {}), { code: "HARNESS_RUN_NOT_FOUND" });
  await initializeRun(run);
  const old = new Date(Date.now() - 40 * DAY_MS);
  await fs.utimes(run.manifest, old, old);
  await createRun(basePath, "keep", { manifest: { sessionId: "s2" } });
  const remove = fs.rm.bind(fs);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.mock.method(fs, "rm", async (target, options) => {
    if (target === run.runDir) {
      entered.resolve();
      await release.promise;
    }
    return remove(target, options);
  });
  const cleanup = cleanupOldRuns(basePath, OPTIONS);
  await Promise.race([entered.promise, cleanup]);
  const late = writeJson(run, run.contextSnapshot, {});
  const rejected = assert.rejects(late, { code: "HARNESS_RUN_NOT_FOUND" });
  release.resolve();
  assert.deepEqual(await cleanup, { deleted: 1, errors: 0 });
  await rejected;
  assert.deepEqual(await listRuns(basePath), ["keep"]);
});
