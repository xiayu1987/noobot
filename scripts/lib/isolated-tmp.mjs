/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEVELOPMENT_THRESHOLDS } from "./development-thresholds.mjs";
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutRuntimeInstancePaths } from "@noobot/runtime-topology-protocol/instance-paths";
import { WORKSPACE_ROOT_ENV } from "@noobot/runtime-topology-protocol/workspace-root";
import { text } from "@noobot/shared/value";

export const ISOLATED_TMP_ENV = "NOOBOT_TEST_TMP_DIR";
const DEFAULT_TMP_MIN_AGE_MS = DEVELOPMENT_THRESHOLDS.time.isolatedTmpMinAgeMs;

export function pruneOldest(dir, matches, keep, { minAgeMs = 0, now = Date.now() } = {}) {
  const uid = os.userInfo().uid;
  const entries = [];
  for (const name of readdirSync(dir).filter(matches)) {
    const stat = lstatSync(path.join(dir, name), { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || (uid >= 0 && stat.uid !== uid)) continue;
    entries.push({ name, mtimeMs: stat.mtimeMs });
  }
  entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
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
  const inherited = text(env[ISOLATED_TMP_ENV]);
  if (inherited) return { dir: inherited, created: false };
  pruneOldest(tmpRoot, (name) => name.startsWith(prefix), Math.max(0, keep - 1), { minAgeMs });
  return { dir: mkdtempSync(path.join(tmpRoot, prefix)), created: true };
}

export function buildIsolatedTmpEnv(dir, env = process.env) {
  return {
    ...withoutRuntimeInstancePaths(env),
    [ISOLATED_TMP_ENV]: dir,
    [WORKSPACE_ROOT_ENV]: path.join(dir, "workspace"),
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
  };
}
