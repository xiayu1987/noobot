/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const DEFAULT_READ_MAX_LINES = QUANTITY_THRESHOLDS.toolIO.readMaxLines;
export const READ_MAX_LINES_LIMIT = QUANTITY_THRESHOLDS.toolIO.readMaxLinesLimit;
export const DEFAULT_SEARCH_MAX_RESULTS = QUANTITY_THRESHOLDS.toolIO.searchMaxResults;
export const SEARCH_MAX_RESULTS_LIMIT = QUANTITY_THRESHOLDS.toolIO.searchMaxResultsLimit;
export const DEFAULT_SEARCH_CONTEXT_LINES = QUANTITY_THRESHOLDS.toolIO.searchContextLines;
export const SEARCH_CONTEXT_LINES_LIMIT = QUANTITY_THRESHOLDS.toolIO.searchContextLinesLimit;
export const PATCH_FAILURE_CONTEXT_RADIUS = QUANTITY_THRESHOLDS.toolIO.patchFailureContextRadius;

export function splitLines(content) {
  return content.split(/\r?\n/);
}

export function formatLinesWithNumbers(lines, startLine) {
  return lines.map((lineText, index) => `${startLine + index} | ${lineText}`).join("\n");
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
