/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { statSync } from "node:fs";
import path from "node:path";

export function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRepoRoot(directory, markerDirectory) {
  return (
    exists(path.join(directory, "package.json")) && exists(path.join(directory, markerDirectory))
  );
}

export function resolveRepoRoot(markerDirectory = "scripts", cwd = process.cwd()) {
  if (isRepoRoot(cwd, markerDirectory)) return cwd;
  const parent = path.dirname(cwd);
  if (isRepoRoot(parent, markerDirectory)) return parent;
  return cwd;
}
