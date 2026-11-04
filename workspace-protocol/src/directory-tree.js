/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function readWorkspaceDirectoryPath(query) {
  const value = query.path;
  if (value === undefined) return "";
  if (typeof value !== "string") throw new TypeError("directory path must be a string");
  return value;
}

export function createWorkspaceDirectoryEntry({ label, path, type }) {
  if (typeof label !== "string" || !label || typeof path !== "string" || !path) {
    throw new TypeError("directory entry requires label and path");
  }
  if (type !== "dir" && type !== "file") throw new TypeError("invalid directory entry type");
  return { label, path, type };
}

export const WORKSPACE_DIRECTORY_TREE_PROPS = Object.freeze({
  label: "label",
  isLeaf: (entry) => entry.type === "file",
});
