/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { hash } from "node:crypto";
import { syncDirectory } from "@noobot/platform-compatibility/file-system";
import { isWorkspacePathSegment } from "@noobot/workspace-protocol";
import { HARNESS_FILES } from "../core/constants.js";
import { discardRunBuffers } from "../store/store.js";
import {
  harnessRunsDirectory,
  manifestSessionIds,
  withHarnessRunsMutation,
} from "../store/run-mutation.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DELETION_DIRECTORY_PREFIX = ".session-deletion-";

function isMissingPathError(error) {
  return error?.code === "ENOENT";
}

async function statIfPresent(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
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
    return entries.map((entry) => {
      if (!entry.isDirectory()) {
        throw new TypeError(
          `harness run must be a directory: ${path.join(harnessRunsDir, entry.name)}`,
        );
      }
      return entry.name;
    });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function readRunManifest(runDirPath) {
  return JSON.parse(await fs.readFile(path.join(runDirPath, HARNESS_FILES.RUN_MANIFEST), "utf8"));
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

async function pruneRunDirs(harnessRunsDir, dirNames) {
  const result = { deleted: 0, errors: 0 };
  for (const dir of dirNames) {
    const target = path.join(harnessRunsDir, dir);
    try {
      await fs.rm(target, { recursive: true, force: true });
      discardRunBuffers(target);
      result.deleted += 1;
    } catch (error) {
      console.warn(`[harness] Failed to delete run directory ${target}:`, error);
      result.errors += 1;
    }
  }
  return result;
}

export async function cleanupOldRuns(basePath, options) {
  if (!basePath) throw new TypeError("harness run retention cleanup requires basePath");
  assertRetentionOptions(options);
  const harnessRunsDir = harnessRunsDirectory(basePath);
  return withHarnessRunsMutation(basePath, async () => {
    const runIds = (await listRunDirNames(harnessRunsDir)).filter(
      (dir) => !dir.startsWith(SESSION_DELETION_DIRECTORY_PREFIX),
    );
    const runs = await collectRunAges(harnessRunsDir, runIds);
    return pruneRunDirs(harnessRunsDir, selectExpiredRuns(runs, options));
  });
}

export async function cleanupRunsBySessionIds(basePath, sessionIds, { signal } = {}) {
  if (!basePath) throw new TypeError("harness session cleanup requires basePath");
  if (
    !Array.isArray(sessionIds) ||
    !sessionIds.length ||
    !Array.from(sessionIds).every(isWorkspacePathSegment)
  ) {
    throw new TypeError("harness session cleanup requires workspace session ids");
  }
  return withHarnessRunsMutation(
    basePath,
    () => stageAndRemoveRuns(basePath, new Set(sessionIds), signal),
    {
      signal,
    },
  );
}

async function stageAndRemoveRuns(basePath, targetIds, signal) {
  const harnessRunsDir = harnessRunsDirectory(basePath);
  const entries = await listRunDirNames(harnessRunsDir);
  if (!entries.length && !(await statIfPresent(harnessRunsDir)))
    return { deleted: 0, matchedRuns: 0 };
  const requestHash = hash("sha256", JSON.stringify([...targetIds].sort()));
  const stagingPrefix = `${SESSION_DELETION_DIRECTORY_PREFIX}${requestHash}-`;
  const staged = entries.filter((dir) => dir.startsWith(stagingPrefix));
  for (const runId of entries) {
    signal?.throwIfAborted();
    if (runId.startsWith(SESSION_DELETION_DIRECTORY_PREFIX)) continue;
    const target = path.join(harnessRunsDir, runId);
    const manifest = await readRunManifest(target);
    if (!manifestSessionIds(manifest).some((id) => targetIds.has(id))) continue;
    const name = `${stagingPrefix}${hash("sha256", runId)}`;
    await fs.rename(target, path.join(harnessRunsDir, name));
    discardRunBuffers(target);
    staged.push(name);
  }
  const syncRuns = () => syncDirectory({ directory: harnessRunsDir, open: fs.open });
  await syncRuns();
  for (const name of staged) {
    signal?.throwIfAborted();
    await fs.rm(path.join(harnessRunsDir, name), { recursive: true, force: true });
  }
  await syncRuns();
  return { deleted: staged.length, matchedRuns: staged.length };
}
