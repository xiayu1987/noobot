/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isMissingPersistencePathError } from "../../shared/storage/json-file-reader.js";

export async function resolveWorkspaceDirectories(runtimeBasePath = "") {
  const basePath = String(runtimeBasePath || "").trim();
  if (!basePath) return [];
  try {
    await access(basePath);
  } catch (error) {
    if (isMissingPersistencePathError(error)) return [];
    throw error;
  }
  const directories = new Set();
  let level1Entries = [];
  try {
    level1Entries = await readdir(basePath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPersistencePathError(error)) return [];
    throw error;
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
    } catch (error) {
      if (!isMissingPersistencePathError(error)) throw error;
    }
    for (const entry of runtimeLevel1Entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      directories.add(["runtime", entry.name].join("/"));
    }
  } catch (error) {
    if (!isMissingPersistencePathError(error)) throw error;
  }
  return Array.from(directories).sort((leftDir, rightDir) => leftDir.localeCompare(rightDir));
}
