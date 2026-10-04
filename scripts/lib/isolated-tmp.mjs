/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ISOLATED_TMP_ENV = "NOOBOT_TEST_TMP_DIR";
export const DEFAULT_TMP_MIN_AGE_MS = 60 * 60 * 1000;

export function pruneOldest(dir, matches, keep, { minAgeMs = 0, now = Date.now() } = {}) {
  let entries;
  try {
    entries = readdirSync(dir)
      .filter(matches)
      .map((name) => ({ name, mtimeMs: statSync(path.join(dir, name)).mtimeMs }))
      .sort((left, right) => left.mtimeMs - right.mtimeMs);
  } catch {
    return;
  }
  for (const { name, mtimeMs } of entries.slice(0, Math.max(0, entries.length - keep))) {
    if (now - mtimeMs < minAgeMs) continue;
    rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

export function acquireIsolatedTmpDir({
  prefix,
  keep,
  minAgeMs = DEFAULT_TMP_MIN_AGE_MS,
  env = process.env,
  tmpRoot = os.tmpdir(),
}) {
  const inherited = String(env[ISOLATED_TMP_ENV] || "").trim();
  if (inherited) return { dir: inherited, created: false };
  pruneOldest(tmpRoot, (name) => name.startsWith(prefix), Math.max(0, keep - 1), { minAgeMs });
  return { dir: mkdtempSync(path.join(tmpRoot, prefix)), created: true };
}

export function buildIsolatedTmpEnv(dir, env = process.env) {
  return { ...env, [ISOLATED_TMP_ENV]: dir, TMPDIR: dir, TMP: dir, TEMP: dir };
}
