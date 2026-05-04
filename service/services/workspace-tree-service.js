/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { safeJoin } from "../system-core/utils/fs-safe.js";

export async function buildWorkspaceTree(
  rootPath,
  currentPath = "",
  depth = 0,
  maxDepth = 12,
) {
  if (depth > maxDepth) return [];
  const absolutePath = currentPath ? safeJoin(rootPath, currentPath) : rootPath;
  const directoryEntries = (await readdir(absolutePath, { withFileTypes: true }))
    .filter((directoryEntry) => !directoryEntry.name.startsWith("."))
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
    const node = {
      label: directoryEntry.name,
      path: relativePath,
      type: directoryEntry.isDirectory() ? "dir" : "file",
    };
    if (directoryEntry.isDirectory()) {
      node.children = await buildWorkspaceTree(
        rootPath,
        relativePath,
        depth + 1,
        maxDepth,
      );
    }
    nodes.push(node);
  }
  return nodes;
}
