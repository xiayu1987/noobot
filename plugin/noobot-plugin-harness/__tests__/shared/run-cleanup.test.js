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

import { cleanupOldRuns, cleanupRunsBySessionIds } from "../../src/utils/cleanup.js";
import { HARNESS_FILES, resolveHarnessRunsRelativePath } from "../../src/core/constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPTIONS = Object.freeze({ maxRuns: 100, maxRunAgeDays: 30, cleanupGraceMs: 60000 });

async function createBase(t) {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "harness-cleanup-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  return basePath;
}

async function createRun(basePath, runId, { ageMs = 0, manifest = {}, locked = false } = {}) {
  const runDir = path.join(basePath, resolveHarnessRunsRelativePath(), runId);
  await fs.mkdir(runDir, { recursive: true });
  const at = new Date(Date.now() - ageMs);
  if (manifest) {
    const manifestPath = path.join(runDir, HARNESS_FILES.RUN_MANIFEST);
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await fs.utimes(manifestPath, at, at);
  }
  if (locked) await fs.writeFile(path.join(runDir, HARNESS_FILES.RUN_WRITE_LOCK), "1", "utf8");
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
    skippedLocked: 0,
  });
});

test("cleanupOldRuns deletes runs older than the retention age", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "old", { ageMs: 40 * DAY_MS });
  await createRun(basePath, "fresh", { ageMs: DAY_MS });
  const result = await cleanupOldRuns(basePath, OPTIONS);
  assert.deepEqual(result, { deleted: 1, errors: 0, skippedLocked: 0 });
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

test("cleanupOldRuns skips runs holding a fresh write lock", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "old-locked", { ageMs: 40 * DAY_MS, locked: true });
  const result = await cleanupOldRuns(basePath, OPTIONS);
  assert.deepEqual(result, { deleted: 0, errors: 0, skippedLocked: 1 });
  assert.deepEqual(await listRuns(basePath), ["old-locked"]);
});

test("cleanupRunsBySessionIds matches run id and manifest session identities", async (t) => {
  const basePath = await createBase(t);
  await createRun(basePath, "s-direct");
  await createRun(basePath, "by-session", { manifest: { sessionId: "s1" } });
  await createRun(basePath, "by-parent", { manifest: { parentSessionId: "s2" } });
  await createRun(basePath, "by-workflow", { manifest: { metadata: { workflowSessionId: "s3" } } });
  await createRun(basePath, "other", { manifest: { sessionId: "keep" } });
  await createRun(basePath, "locked", { manifest: { sessionId: "s1" }, locked: true });
  const result = await cleanupRunsBySessionIds(basePath, ["s-direct", "s1", "s2", "s3"], OPTIONS);
  assert.deepEqual(result, { deleted: 4, errors: 0, matchedRuns: 5, skippedLocked: 1 });
  assert.deepEqual(await listRuns(basePath), ["locked", "other"]);
});

test("cleanupRunsBySessionIds rejects missing session ids", async (t) => {
  const basePath = await createBase(t);
  await assert.rejects(() => cleanupRunsBySessionIds(basePath, [], OPTIONS), TypeError);
  await assert.rejects(() => cleanupRunsBySessionIds(basePath, "s1", OPTIONS), TypeError);
});
