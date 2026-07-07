/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat, readFile, readdir } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  DEFAULT_MAX_SEARCH_FILES,
  DEFAULT_SEARCH_CONTEXT_LINES,
  DEFAULT_SEARCH_EXCLUDED_DIRS,
  DEFAULT_SEARCH_MAX_RESULTS,
  MAX_SEARCH_BUFFER_SIZE,
  MAX_SEARCH_FILE_BYTES,
  RIPGREP_MAX_FILESIZE,
  escapeRegExp,
  isForbiddenWorkspaceRelativePath,
  matchesGlob,
  normalizeRgPathToWorkspace,
  splitLines,
  toPositiveInt,
  toTextLine,
  toWorkspaceRelativePath,
} from "./file-utils.js";

const execFile = promisify(execFileCallback);
let ripgrepAvailablePromise = null;

function buildSearchMatcher({ query = "", isRegex = false, caseSensitive = false } = {}) {
  const source = String(query || "");
  const flags = caseSensitive ? "g" : "gi";
  try {
    return new RegExp(isRegex ? source : escapeRegExp(source), flags);
  } catch (error) {
    throw recoverableToolError(`invalid search regex: ${error?.message || String(error)}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "query" },
    });
  }
}

export function searchInText({
  text = "",
  query = "",
  isRegex = false,
  caseSensitive = false,
  contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
  maxResults = DEFAULT_SEARCH_MAX_RESULTS,
  filePath = "",
} = {}) {
  const matcher = buildSearchMatcher({ query, isRegex, caseSensitive });
  const lines = splitLines(text);
  if (String(text || "").endsWith("\n")) lines.pop();
  const matches = [];
  const contextCount = toPositiveInt(contextLines, DEFAULT_SEARCH_CONTEXT_LINES, 0, 20);
  const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    matcher.lastIndex = 0;
    const hit = matcher.exec(lineText);
    if (!hit) continue;
    const beforeStart = Math.max(0, lineIndex - contextCount);
    const afterEnd = Math.min(lines.length - 1, lineIndex + contextCount);
    matches.push({
      ...(filePath ? { filePath } : {}),
      line: lineIndex + 1,
      column: Number(hit.index || 0) + 1,
      text: lineText,
      before: lines.slice(beforeStart, lineIndex).map((item, offset) => ({
        line: beforeStart + offset + 1,
        text: item,
      })),
      after: lines.slice(lineIndex + 1, afterEnd + 1).map((item, offset) => ({
        line: lineIndex + offset + 2,
        text: item,
      })),
    });
    if (matches.length >= maxCount) break;
  }
  return {
    matches,
    truncated: matches.length >= maxCount,
  };
}

function throwIfAborted(abortSignal = null) {
  if (!abortSignal?.aborted) return;
  throw abortSignal.reason || new DOMException("The operation was aborted", "AbortError");
}

export async function collectSearchFiles({ rootPath = "", workspacePath = "", glob = "", maxFiles = DEFAULT_MAX_SEARCH_FILES, abortSignal = null } = {}) {
  const files = [];
  async function walk(currentPath) {
    throwIfAborted(abortSignal);
    if (files.length >= maxFiles) return;
    let entryStat;
    try {
      entryStat = await lstat(currentPath);
    } catch {
      return;
    }
    if (entryStat.isSymbolicLink()) return;
    const rel = toWorkspaceRelativePath(workspacePath, currentPath);
    if (rel && isForbiddenWorkspaceRelativePath(rel)) return;
    if (entryStat.isDirectory()) {
      const base = path.basename(currentPath);
      if (DEFAULT_SEARCH_EXCLUDED_DIRS.has(base)) return;
      let entries = [];
      try {
        entries = await readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        await walk(path.join(currentPath, entry.name));
      }
      return;
    }
    if (!entryStat.isFile()) return;
    if (Number(entryStat.size || 0) > MAX_SEARCH_FILE_BYTES) return;
    if (!matchesGlob(rel || path.basename(currentPath), glob)) return;
    files.push({ filePath: currentPath, relativePath: rel });
  }
  await walk(rootPath);
  return files;
}

export async function hasRipgrep() {
  if (!ripgrepAvailablePromise) {
    ripgrepAvailablePromise = execFile("rg", ["--version"])
      .then(() => true)
      .catch(() => false);
  }
  return ripgrepAvailablePromise;
}


export async function searchFilesWithRipgrep({
  rootPath = "",
  workspacePath = "",
  query = "",
  isRegex = false,
  caseSensitive = false,
  glob = "",
  contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
  maxResults = DEFAULT_SEARCH_MAX_RESULTS,
  abortSignal = null,
} = {}) {
  throwIfAborted(abortSignal);
  const contextCount = toPositiveInt(contextLines, DEFAULT_SEARCH_CONTEXT_LINES, 0, 20);
  const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--max-filesize",
    RIPGREP_MAX_FILESIZE,
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/node_modules/**",
    "--glob",
    "!**/.pm2/**",
    "--glob",
    "!**/dist/**",
    "--glob",
    "!**/build/**",
    "--glob",
    "!**/coverage/**",
  ];
  args.push("--max-count", String(maxCount));
  if (contextCount > 0) {
    args.push("--context", String(contextCount));
  }
  if (!caseSensitive) args.push("-i");
  if (!isRegex) args.push("-F");
  if (String(glob || "").trim()) {
    args.push("--glob", String(glob || "").trim());
  }
  args.push(String(query || "").trim(), ".");

  let stdout = "";
  try {
    const result = await execFile("rg", args, {
      cwd: rootPath,
      maxBuffer: MAX_SEARCH_BUFFER_SIZE,
      signal: abortSignal || undefined,
    });
    stdout = String(result?.stdout || "");
  } catch (error) {
    // rg exits with code=1 when there are no matches. This is not an error for search.
    if (Number(error?.code) !== 1) throw error;
    stdout = String(error?.stdout || "");
  }
  if (!stdout.trim()) {
    return { matches: [], truncated: false };
  }

  const rawMatches = [];
  const contextByFile = new Map();
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = String(event?.type || "").trim();
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    const filePathRaw = String(data?.path?.text || "").trim();
    if (!filePathRaw) continue;
    if (type === "match") {
      const lineNumber = Number(data?.line_number || 0);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      const lineText = toTextLine(data?.lines?.text || "");
      const firstSubmatch =
        Array.isArray(data?.submatches) && data.submatches.length ? data.submatches[0] : {};
      rawMatches.push({
        filePathRaw,
        line: lineNumber,
        column: Number(firstSubmatch?.start || 0) + 1,
        text: lineText,
      });
      continue;
    }
    if (type === "context") {
      const lineNumber = Number(data?.line_number || 0);
      if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
      const lineText = toTextLine(data?.lines?.text || "");
      const fileMap = contextByFile.get(filePathRaw) || new Map();
      fileMap.set(lineNumber, lineText);
      contextByFile.set(filePathRaw, fileMap);
    }
  }

  const matches = [];
  for (const item of rawMatches) {
    if (matches.length >= maxCount) break;
    const relativePath = normalizeRgPathToWorkspace({
      rootPath,
      workspacePath,
      rgPath: item.filePathRaw,
    });
    if (!relativePath || isForbiddenWorkspaceRelativePath(relativePath)) continue;
    const fileContextMap = contextByFile.get(item.filePathRaw) || new Map();
    const before = [];
    const after = [];
    for (let lineNo = item.line - contextCount; lineNo < item.line; lineNo += 1) {
      if (!fileContextMap.has(lineNo)) continue;
      before.push({ line: lineNo, text: fileContextMap.get(lineNo) });
    }
    for (let lineNo = item.line + 1; lineNo <= item.line + contextCount; lineNo += 1) {
      if (!fileContextMap.has(lineNo)) continue;
      after.push({ line: lineNo, text: fileContextMap.get(lineNo) });
    }
    matches.push({
      filePath: relativePath,
      line: item.line,
      column: item.column,
      text: item.text,
      before,
      after,
    });
  }
  return {
    matches,
    truncated: rawMatches.length > maxCount || matches.length >= maxCount,
  };
}

