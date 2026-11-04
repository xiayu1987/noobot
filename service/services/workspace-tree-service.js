/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { safeJoin } from "#agent/utils";
import { text } from "@noobot/shared/value";
import { createWorkspaceDirectoryEntry } from "@noobot/workspace-protocol/directory-tree";

function isWorkspaceControlEntry(name = "") {
  const normalized = text(name);
  return normalized.endsWith(".mutation-lock") || normalized.endsWith(".mutation-locks");
}

export async function buildWorkspaceTree(rootPath, currentPath = "") {
  const absolutePath = currentPath ? safeJoin(rootPath, currentPath) : rootPath;
  const directoryEntries = (await readdir(absolutePath, { withFileTypes: true }))
    .filter(
      (directoryEntry) =>
        !directoryEntry.name.startsWith(".") && !isWorkspaceControlEntry(directoryEntry.name),
    )
    .sort((leftEntry, rightEntry) => {
      if (leftEntry.isDirectory() && !rightEntry.isDirectory()) return -1;
      if (!leftEntry.isDirectory() && rightEntry.isDirectory()) return 1;
      return leftEntry.name.localeCompare(rightEntry.name);
    });

  const nodes = [];
  for (const directoryEntry of directoryEntries) {
    const relativePath = currentPath
      ? path.posix.join(currentPath, directoryEntry.name)
      : directoryEntry.name;
    const node = createWorkspaceDirectoryEntry({
      label: directoryEntry.name,
      path: relativePath,
      type: directoryEntry.isDirectory() ? "dir" : "file",
    });
    nodes.push(node);
  }
  return nodes;
}
