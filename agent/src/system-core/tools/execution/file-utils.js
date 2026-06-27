/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const MAX_FILE_CONTENT_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;
export const MAX_FILE_CONTENT_BYTES_PRECHECK =
  LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars *
  LENGTH_THRESHOLDS.toolIO.fileContentBytesPrecheckMultiplier;
export const MAX_SEARCH_TEXT_CHARS = LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;
export const MAX_SEARCH_FILE_BYTES = LENGTH_THRESHOLDS.toolIO.searchFileBytes;
export const DEFAULT_READ_MAX_LINES = QUANTITY_THRESHOLDS.toolIO.readMaxLines;
export const DEFAULT_SEARCH_MAX_RESULTS = QUANTITY_THRESHOLDS.toolIO.searchMaxResults;
export const DEFAULT_SEARCH_CONTEXT_LINES = QUANTITY_THRESHOLDS.toolIO.searchContextLines;
export const DEFAULT_MAX_SEARCH_FILES = QUANTITY_THRESHOLDS.toolIO.searchMaxFiles;
export const MAX_SEARCH_BUFFER_SIZE = LENGTH_THRESHOLDS.toolIO.searchBufferBytes;
export const RIPGREP_MAX_FILESIZE = LENGTH_THRESHOLDS.toolIO.ripgrepMaxFilesize;
export const DEFAULT_SEARCH_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".pm2",
  "dist",
  "build",
  "coverage",
]);

export function toPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function splitLines(content = "") {
  return String(content || "").split(/\r?\n/);
}

export function formatLinesWithNumbers(lines = [], startLine = 1) {
  return lines
    .map((lineText, index) => `${startLine + index} | ${lineText}`)
    .join("\n");
}

export function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSlash(value = "") {
  return String(value || "").replaceAll("\\", "/");
}

export function toWorkspaceRelativePath(workspacePath = "", targetPath = "") {
  return normalizeSlash(path.relative(workspacePath, targetPath));
}

export function isForbiddenWorkspaceRelativePath(relativePath = "") {
  return normalizeSlash(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment === ".git");
}

export function globToRegExp(glob = "") {
  const normalized = normalizeSlash(glob).trim();
  if (!normalized) return null;
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(ch);
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(relativePath = "", glob = "") {
  const normalizedGlob = normalizeSlash(glob).trim();
  if (!normalizedGlob) return true;
  const normalizedPath = normalizeSlash(relativePath);
  const fileName = path.posix.basename(normalizedPath);
  const matcher = globToRegExp(normalizedGlob);
  if (!matcher) return true;
  return matcher.test(normalizedPath) || matcher.test(fileName);
}


export function toTextLine(value = "") {
  return String(value || "").replace(/\r?\n$/, "");
}

export function normalizeRgPathToWorkspace({ rootPath = "", workspacePath = "", rgPath = "" } = {}) {
  const absolutePath = path.resolve(rootPath, String(rgPath || ""));
  return toWorkspaceRelativePath(workspacePath, absolutePath);
}

export async function exists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
