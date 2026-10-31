/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HARNESS_FILES, resolveHarnessRunsRelativePath } from "../core/constants.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { text } from "@noobot/shared/value";

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_WRITE_LOCK_STALE_MS = TIME_THRESHOLDS.harness.runWriteLockStaleMs;

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function statIfPresent(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function unlinkIfPresent(targetPath) {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function normalizeSessionIds(input) {
  if (!Array.isArray(input)) throw new TypeError("harness run cleanup sessionIds must be an array");
  return input.map((item) => text(item)).filter(Boolean);
}

function assertRetentionOptions(options) {
  const { maxRuns, maxRunAgeDays, cleanupGraceMs } = options;
  if (!(Number.isFinite(maxRuns) && maxRuns > 0))
    throw new TypeError("harness run cleanup requires positive options.maxRuns");
  if (!(Number.isFinite(maxRunAgeDays) && maxRunAgeDays > 0))
    throw new TypeError("harness run cleanup requires positive options.maxRunAgeDays");
  if (!(Number.isFinite(cleanupGraceMs) && cleanupGraceMs >= 0))
    throw new TypeError("harness run cleanup requires non-negative options.cleanupGraceMs");
}

async function listRunDirNames(harnessRunsDir) {
  try {
    const entries = await fs.readdir(harnessRunsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function readRunManifest(runDirPath) {
  const raw = await readFileIfPresent(path.join(runDirPath, HARNESS_FILES.RUN_MANIFEST));
  if (raw === null) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object")
    throw new TypeError(`harness run manifest must be an object: ${runDirPath}`);
  return parsed;
}

async function readFileIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function isRunWriteLocked(runDirPath) {
  const lockPath = path.join(runDirPath, HARNESS_FILES.RUN_WRITE_LOCK);
  const stat = await statIfPresent(lockPath);
  if (!stat) return false;
  if (Date.now() - stat.mtimeMs <= RUN_WRITE_LOCK_STALE_MS) return true;
  await unlinkIfPresent(lockPath);
  return false;
}

async function readRunActivityMs(runDirPath) {
  const stat =
    (await statIfPresent(path.join(runDirPath, HARNESS_FILES.RUN_MANIFEST))) ||
    (await statIfPresent(runDirPath));
  return stat ? stat.mtimeMs : null;
}

async function collectRunAges(harnessRunsDir, dirNames) {
  const now = Date.now();
  const runs = [];
  for (const dir of dirNames) {
    const mtime = await readRunActivityMs(path.join(harnessRunsDir, dir));
    if (mtime !== null) runs.push({ dir, mtime, age: now - mtime });
  }
  return runs.sort((left, right) => left.mtime - right.mtime);
}

function selectExpiredRuns(runs, options) {
  const maxAgeMs = options.maxRunAgeDays * DAY_MS;
  const candidates = runs.filter((run) => run.age >= options.cleanupGraceMs);
  const selected = new Set(candidates.filter((run) => run.age > maxAgeMs).map((run) => run.dir));
  const overflow = runs.length - selected.size - options.maxRuns;
  const extra = candidates.filter((run) => !selected.has(run.dir)).slice(0, Math.max(0, overflow));
  for (const run of extra) selected.add(run.dir);
  return selected;
}

async function deleteRunDirs(harnessRunsDir, dirNames) {
  const result = { deleted: 0, errors: 0, skippedLocked: 0 };
  for (const dir of dirNames) {
    const target = path.join(harnessRunsDir, dir);
    if (await isRunWriteLocked(target)) {
      result.skippedLocked += 1;
      continue;
    }
    try {
      await fs.rm(target, { recursive: true, force: true });
      result.deleted += 1;
    } catch (error) {
      console.warn(`[harness] Failed to delete run directory ${target}:`, error);
      result.errors += 1;
    }
  }
  return result;
}

function resolveHarnessRunsDir(basePath) {
  return path.join(basePath, resolveHarnessRunsRelativePath());
}

export async function cleanupOldRuns(basePath, options) {
  if (!basePath) throw new TypeError("harness run retention cleanup requires basePath");
  assertRetentionOptions(options);
  const harnessRunsDir = resolveHarnessRunsDir(basePath);
  const runs = await collectRunAges(harnessRunsDir, await listRunDirNames(harnessRunsDir));
  return deleteRunDirs(harnessRunsDir, selectExpiredRuns(runs, options));
}

function manifestSessionIds(manifest) {
  if (!manifest) return [];
  return [manifest.sessionId, manifest.parentSessionId, manifest.metadata?.workflowSessionId]
    .map((value) => text(value))
    .filter(Boolean);
}

async function runBelongsToSessions(harnessRunsDir, dir, sessionIds) {
  if (sessionIds.has(dir)) return true;
  const manifest = await readRunManifest(path.join(harnessRunsDir, dir));
  return manifestSessionIds(manifest).some((id) => sessionIds.has(id));
}

export async function cleanupRunsBySessionIds(basePath, sessionIds) {
  if (!basePath) throw new TypeError("harness session cleanup requires basePath");
  const targetIds = new Set(normalizeSessionIds(sessionIds));
  if (!targetIds.size) throw new TypeError("harness session cleanup requires sessionIds");
  const harnessRunsDir = resolveHarnessRunsDir(basePath);
  const matched = [];
  for (const dir of await listRunDirNames(harnessRunsDir)) {
    if (await runBelongsToSessions(harnessRunsDir, dir, targetIds)) matched.push(dir);
  }
  const result = await deleteRunDirs(harnessRunsDir, matched);
  return { ...result, matchedRuns: matched.length };
}
