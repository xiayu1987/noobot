/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "@noobot/shared/file-system";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { isMissingPersistencePathError } from "../../shared/storage/json-file-reader.js";
import { text } from "@noobot/shared/value";

async function readWorkspaceDirectoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPersistencePathError(error)) return [];
    throw error;
  }
}

export async function resolveWorkspaceDirectories(runtimeBasePath = "") {
  const basePath = text(runtimeBasePath);
  if (!basePath) return [];
  const directories = new Set();
  const level1Entries = await readWorkspaceDirectoryEntries(basePath);
  for (const entry of level1Entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    directories.add(entry.name);
  }
  const runtimeDirPath = path.join(basePath, WORKSPACE_LAYOUT.RUNTIME_DIR);
  for (const entry of await readWorkspaceDirectoryEntries(runtimeDirPath)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    directories.add([WORKSPACE_LAYOUT.RUNTIME_DIR, entry.name].join("/"));
  }
  return Array.from(directories).sort((leftDir, rightDir) => leftDir.localeCompare(rightDir));
}
