/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readdir } from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspaceDirectories(runtimeBasePath = "") {
  const basePath = String(runtimeBasePath || "").trim();
  if (!basePath) return [];
  try {
    await access(basePath);
  } catch {
    return [];
  }
  const directories = new Set();
  let level1Entries = [];
  try {
    level1Entries = await readdir(basePath, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of level1Entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    directories.add(entry.name);
  }
  const runtimeDirPath = path.join(basePath, "runtime");
  try {
    await access(runtimeDirPath);
    let runtimeLevel1Entries = [];
    try {
      runtimeLevel1Entries = await readdir(runtimeDirPath, { withFileTypes: true });
    } catch {
      runtimeLevel1Entries = [];
    }
    for (const entry of runtimeLevel1Entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      directories.add(path.posix.join("runtime", entry.name));
    }
  } catch {}
  return Array.from(directories).sort((leftDir, rightDir) =>
    leftDir.localeCompare(rightDir),
  );
}

