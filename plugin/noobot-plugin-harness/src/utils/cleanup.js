/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

function normalizeSessionIds(input = []) {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const single = String(input || "").trim();
  return single ? [single] : [];
}

async function resolveRunSessionId(manifestPath = "") {
  if (!manifestPath) return "";
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed?.sessionId || "").trim();
  } catch {
    return "";
  }
}

export async function cleanupOldRuns(basePath, options = {}) {
  if (!basePath) return { deleted: 0, errors: 0 };
  const runtimeDirName = options.runtimeDirName || "runtime";
  const harnessDirName = options.harnessDirName || "harness";
  const maxRuns = Number.isFinite(Number(options.maxRuns)) ? Number(options.maxRuns) : 100;
  const maxRunAgeDays = Number.isFinite(Number(options.maxRunAgeDays)) ? Number(options.maxRunAgeDays) : 30;
  const cleanupGraceMs =
    Number.isFinite(Number(options.cleanupGraceMs)) && Number(options.cleanupGraceMs) >= 0
      ? Number(options.cleanupGraceMs)
      : 10 * 60 * 1000;

  const harnessRunsDir = path.join(basePath, runtimeDirName, harnessDirName, "runs");
  let deleted = 0;
  let errors = 0;

  try {
    const entries = await fs.readdir(harnessRunsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    if (dirs.length === 0) return { deleted: 0, errors: 0 };

    const maxAgeMs = maxRunAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const runInfo = [];

    for (const dir of dirs) {
      const manifestPath = path.join(harnessRunsDir, dir, "harness-run.json");
      const runDirPath = path.join(harnessRunsDir, dir);
      let mtime = 0;
      try {
        const stat = await fs.stat(manifestPath);
        mtime = stat.mtimeMs;
      } catch {
        // Fallback to run directory mtime when manifest is not ready yet.
        try {
          const dirStat = await fs.stat(runDirPath);
          mtime = dirStat.mtimeMs;
        } catch {
          mtime = 0;
        }
      }
      runInfo.push({ dir, mtime, age: now - mtime });
    }

    // Sort by age (oldest first)
    runInfo.sort((a, b) => a.mtime - b.mtime);

    // Determine which to delete: age-based + count-based
    const toDelete = new Set();
    for (const info of runInfo) {
      if (info.mtime > 0 && info.age < cleanupGraceMs) continue;
      if (info.age > maxAgeMs) {
        toDelete.add(info.dir);
      }
    }

    // If still over maxRuns, delete oldest until within limit
    const remaining = dirs.length - toDelete.size;
    if (remaining > maxRuns) {
      let count = 0;
      for (const info of runInfo) {
        if (info.mtime > 0 && info.age < cleanupGraceMs) continue;
        if (!toDelete.has(info.dir)) {
          toDelete.add(info.dir);
          count++;
          if (dirs.length - toDelete.size <= maxRuns) break;
        }
      }
    }

    // Execute deletions
    for (const dir of toDelete) {
      const target = path.join(harnessRunsDir, dir);
      try {
        await fs.rm(target, { recursive: true, force: true });
        deleted++;
      } catch {
        errors++;
      }
    }
  } catch {
    // Runs dir doesn't exist yet
  }

  return { deleted, errors };
}

export async function cleanupRunsBySessionIds(basePath, sessionIds = [], options = {}) {
  if (!basePath) return { deleted: 0, errors: 0, matchedRuns: 0 };
  const normalizedIds = new Set(normalizeSessionIds(sessionIds));
  if (!normalizedIds.size) return { deleted: 0, errors: 0, matchedRuns: 0 };

  const runtimeDirName = options.runtimeDirName || "runtime";
  const harnessDirName = options.harnessDirName || "harness";
  const harnessRunsDir = path.join(basePath, runtimeDirName, harnessDirName, "runs");
  let deleted = 0;
  let errors = 0;
  let matchedRuns = 0;

  try {
    const entries = await fs.readdir(harnessRunsDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    for (const runDirName of dirs) {
      const manifestPath = path.join(harnessRunsDir, runDirName, "harness-run.json");
      const manifestSessionId = await resolveRunSessionId(manifestPath);
      const shouldDelete = normalizedIds.has(runDirName) || (manifestSessionId && normalizedIds.has(manifestSessionId));
      if (!shouldDelete) continue;
      matchedRuns += 1;
      try {
        await fs.rm(path.join(harnessRunsDir, runDirName), { recursive: true, force: true });
        deleted += 1;
      } catch {
        errors += 1;
      }
    }
  } catch {
    // Runs dir doesn't exist yet
  }

  return { deleted, errors, matchedRuns };
}
