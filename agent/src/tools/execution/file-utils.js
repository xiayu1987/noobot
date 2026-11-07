/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";

export function splitLines(content) {
  return content.split(/\r?\n/);
}

export { formatLinesWithNumbers } from "@noobot/file-mutation-protocol";

export function normalizeSlash(value) {
  return value.replaceAll("\\", "/");
}

export function toWorkspaceRelativePath(workspacePath, targetPath) {
  return normalizeSlash(path.relative(workspacePath, targetPath));
}

export function isForbiddenWorkspaceRelativePath(relativePath) {
  return normalizeSlash(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment === ".git");
}

export function isOutsideWorkspaceRelativePath(relativePath) {
  const normalized = normalizeSlash(relativePath);
  if (path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) return true;
  return normalized.split("/")[0] === "..";
}

export function normalizeRgPathToRoot({ rootPath, rgPath }) {
  return toWorkspaceRelativePath(rootPath, path.resolve(rootPath, rgPath));
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
