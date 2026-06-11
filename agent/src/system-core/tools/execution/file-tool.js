/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../core/check-tool-input.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { TRANSFER_REASON, TRANSFER_SOURCE } from "../../semantic-transfer/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";

const MAX_FILE_CONTENT_CHARS = 8000;
const MAX_FILE_CONTENT_BYTES_PRECHECK = 20000;
const MAX_SEARCH_TEXT_CHARS = 200000;
const MAX_SEARCH_FILE_BYTES = 512000;
const DEFAULT_READ_MAX_LINES = 500;
const DEFAULT_SEARCH_MAX_RESULTS = 50;
const DEFAULT_SEARCH_CONTEXT_LINES = 2;
const DEFAULT_SEARCH_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".pm2",
  "dist",
  "build",
  "coverage",
]);
const execFile = promisify(execFileCallback);

function toPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function splitLines(content = "") {
  return String(content || "").split(/\r?\n/);
}

function formatLinesWithNumbers(lines = [], startLine = 1) {
  return lines
    .map((lineText, index) => `${startLine + index} | ${lineText}`)
    .join("\n");
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlash(value = "") {
  return String(value || "").replaceAll("\\", "/");
}

function isForbiddenWorkspaceRelativePath(relativePath = "") {
  return normalizeSlash(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment === ".git");
}

function globToRegExp(glob = "") {
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

function matchesGlob(relativePath = "", glob = "") {
  const normalizedGlob = normalizeSlash(glob).trim();
  if (!normalizedGlob) return true;
  const normalizedPath = normalizeSlash(relativePath);
  const fileName = path.posix.basename(normalizedPath);
  const matcher = globToRegExp(normalizedGlob);
  if (!matcher) return true;
  return matcher.test(normalizedPath) || matcher.test(fileName);
}

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

function searchInText({
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

async function collectSearchFiles({ rootPath = "", workspacePath = "", glob = "", maxFiles = 2000 } = {}) {
  const files = [];
  async function walk(currentPath) {
    if (files.length >= maxFiles) return;
    let entryStat;
    try {
      entryStat = await lstat(currentPath);
    } catch {
      return;
    }
    if (entryStat.isSymbolicLink()) return;
    const rel = normalizeSlash(path.relative(workspacePath, currentPath));
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
        await walk(path.join(currentPath, entry.name));
        if (files.length >= maxFiles) break;
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

async function hasRipgrep() {
  try {
    await execFile("rg", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function toTextLine(value = "") {
  return String(value || "").replace(/\r?\n$/, "");
}

function normalizeRgPathToWorkspace({ rootPath = "", workspacePath = "", rgPath = "" } = {}) {
  const absolutePath = path.resolve(rootPath, String(rgPath || ""));
  return normalizeSlash(path.relative(workspacePath, absolutePath));
}

async function searchFilesWithRipgrep({
  rootPath = "",
  workspacePath = "",
  query = "",
  isRegex = false,
  caseSensitive = false,
  glob = "",
  contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
  maxResults = DEFAULT_SEARCH_MAX_RESULTS,
} = {}) {
  const contextCount = toPositiveInt(contextLines, DEFAULT_SEARCH_CONTEXT_LINES, 0, 20);
  const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--max-filesize",
    "512K",
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
      maxBuffer: 16 * 1024 * 1024,
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

function parseUnifiedHunkHeader(header = "") {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!match) {
    throw recoverableToolError(`invalid unified diff hunk header: ${header}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] || "1"),
  };
}

function stripDiffPath(rawPath = "", strip = 1) {
  const withoutTimestamp = String(rawPath || "").trim().split(/\s+/)[0] || "";
  if (!withoutTimestamp || withoutTimestamp === "/dev/null") return withoutTimestamp;
  const normalized = normalizeSlash(withoutTimestamp);
  const parts = normalized.split("/").filter(Boolean);
  const stripCount = toPositiveInt(strip, 1, 0, 10);
  return parts.slice(stripCount).join("/") || normalized;
}

function parseUnifiedDiff(patch = "", strip = 1) {
  const lines = String(patch || "").replace(/\r\n/g, "\n").split("\n");
  const filePatches = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("--- ")) {
      i += 1;
      continue;
    }
    const oldPath = stripDiffPath(lines[i].slice(4), strip);
    i += 1;
    if (!lines[i]?.startsWith("+++ ")) {
      throw recoverableToolError("invalid unified diff: missing +++ file header", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch" },
      });
    }
    const newPath = stripDiffPath(lines[i].slice(4), strip);
    i += 1;
    const hunks = [];
    while (i < lines.length && !lines[i].startsWith("--- ")) {
      if (!lines[i].startsWith("@@")) {
        i += 1;
        continue;
      }
      const header = parseUnifiedHunkHeader(lines[i]);
      i += 1;
      const hunkLines = [];
      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("--- ")
      ) {
        if (lines[i] === "\\ No newline at end of file") {
          i += 1;
          continue;
        }
        const prefix = lines[i][0];
        if ([" ", "+", "-"].includes(prefix)) {
          hunkLines.push({ type: prefix, text: lines[i].slice(1) });
        }
        i += 1;
      }
      hunks.push({ ...header, lines: hunkLines });
    }
    filePatches.push({ oldPath, newPath, hunks, mode: newPath === "/dev/null" ? "delete" : oldPath === "/dev/null" ? "add" : "update" });
  }
  if (!filePatches.length) {
    throw recoverableToolError("invalid unified diff: no file patch found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return filePatches;
}

function applyUnifiedHunks(originalContent = "", hunks = []) {
  const hadFinalNewline = String(originalContent || "").endsWith("\n");
  const originalLines = splitLines(originalContent);
  if (hadFinalNewline) originalLines.pop();
  const output = [];
  let pointer = 0;
  for (const hunk of hunks) {
    const hunkStart = Math.max(0, Number(hunk.oldStart || 1) - 1);
    if (hunkStart < pointer) {
      throw recoverableToolError("patch hunks overlap or are out of order", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch" },
      });
    }
    output.push(...originalLines.slice(pointer, hunkStart));
    pointer = hunkStart;
    for (const line of hunk.lines || []) {
      if (line.type === " ") {
        if (originalLines[pointer] !== line.text) {
          throw recoverableToolError("patch context does not match target file", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: { field: "patch", expected: line.text, actual: originalLines[pointer] },
          });
        }
        output.push(line.text);
        pointer += 1;
      } else if (line.type === "-") {
        if (originalLines[pointer] !== line.text) {
          throw recoverableToolError("patch removal does not match target file", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: { field: "patch", expected: line.text, actual: originalLines[pointer] },
          });
        }
        pointer += 1;
      } else if (line.type === "+") {
        output.push(line.text);
      }
    }
  }
  output.push(...originalLines.slice(pointer));
  return output.join("\n") + (hadFinalNewline ? "\n" : "");
}

function parseApplyPatch(patch = "") {
  const lines = String(patch || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch" || !lines.some((line) => line === "*** End Patch")) {
    throw recoverableToolError("invalid apply_patch: missing Begin/End Patch marker", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  const patches = [];
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "*** End Patch") break;
    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      i += 1;
      const contentLines = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (!lines[i].startsWith("+")) {
          throw recoverableToolError("invalid apply_patch add file line: expected + prefix", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: { field: "patch" },
          });
        }
        contentLines.push(lines[i].slice(1));
        i += 1;
      }
      patches.push({ mode: "add", newPath: filePath, content: contentLines.join("\n") + (contentLines.length ? "\n" : "") });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      patches.push({ mode: "delete", oldPath: line.slice("*** Delete File: ".length).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const oldPath = line.slice("*** Update File: ".length).trim();
      let newPath = oldPath;
      i += 1;
      if (lines[i]?.startsWith("*** Move to: ")) {
        newPath = lines[i].slice("*** Move to: ".length).trim();
        i += 1;
      }
      const hunks = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (lines[i].startsWith("@@")) {
          i += 1;
          const hunkLines = [];
          while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("*** ")) {
            const prefix = lines[i][0];
            if ([" ", "+", "-"].includes(prefix)) {
              hunkLines.push({ type: prefix, text: lines[i].slice(1) });
            }
            i += 1;
          }
          hunks.push({ lines: hunkLines });
          continue;
        }
        i += 1;
      }
      patches.push({ mode: newPath === oldPath ? "update" : "move", oldPath, newPath, hunks });
      continue;
    }
    i += 1;
  }
  if (!patches.length) {
    throw recoverableToolError("invalid apply_patch: no file operation found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return patches;
}

function findSubsequence(lines = [], pattern = [], startIndex = 0) {
  if (!pattern.length) return Math.max(0, startIndex);
  for (let i = Math.max(0, startIndex); i <= lines.length - pattern.length; i += 1) {
    let ok = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (lines[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function applySearchHunks(originalContent = "", hunks = []) {
  const hadFinalNewline = String(originalContent || "").endsWith("\n");
  const originalLines = splitLines(originalContent);
  if (hadFinalNewline) originalLines.pop();
  let output = [...originalLines];
  let searchStart = 0;
  for (const hunk of hunks) {
    const oldPattern = (hunk.lines || [])
      .filter((line) => line.type === " " || line.type === "-")
      .map((line) => line.text);
    const newBlock = (hunk.lines || [])
      .filter((line) => line.type === " " || line.type === "+")
      .map((line) => line.text);
    const hit = findSubsequence(output, oldPattern, searchStart);
    if (hit < 0) {
      throw recoverableToolError("apply_patch hunk context does not match target file", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch" },
      });
    }
    output = [
      ...output.slice(0, hit),
      ...newBlock,
      ...output.slice(hit + oldPattern.length),
    ];
    searchStart = hit + newBlock.length;
  }
  return output.join("\n") + (hadFinalNewline ? "\n" : "");
}

async function exists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePatchTargets({ patches = [], agentContext = {} } = {}) {
  const resolved = [];
  for (const item of patches) {
    const targetPath = item.newPath && item.newPath !== "/dev/null" ? item.newPath : item.oldPath;
    assertValidFileNameFromPath({ filePath: targetPath, fieldName: "patch.path" });
    if (isForbiddenWorkspaceRelativePath(targetPath)) {
      throw recoverableToolError(`patch path is not allowed: ${targetPath}`, {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: { field: "patch", filePath: targetPath },
      });
    }
    const resolvedNewPath = item.newPath && item.newPath !== "/dev/null"
      ? await assertAndResolveUserWorkspaceFilePath({ filePath: item.newPath, agentContext, fieldName: "patch.newPath", mustExist: false })
      : "";
    const resolvedOldPath = item.oldPath && item.oldPath !== "/dev/null"
      ? await assertAndResolveUserWorkspaceFilePath({ filePath: item.oldPath, agentContext, fieldName: "patch.oldPath", mustExist: item.mode !== "add" })
      : "";
    resolved.push({ ...item, resolvedOldPath, resolvedNewPath });
  }
  return resolved;
}

export function createFileTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;

  const readFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.READ_FILE,
    description: tTool(agentContext, "tools.file.readDescriptionWithLineNumbers"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.readFilePathField")),
      startLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readStartLineField")),
      endLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readEndLineField")),
      includeLineNumbers: z.boolean().optional().default(true).describe(tTool(agentContext, "tools.file.readIncludeLineNumbersField")),
      maxLines: z.number().int().optional().default(DEFAULT_READ_MAX_LINES).describe(tTool(agentContext, "tools.file.readMaxLinesField")),
    }),
    func: async ({ filePath, startLine, endLine, includeLineNumbers = true, maxLines = DEFAULT_READ_MAX_LINES }) => {
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const fileStat = await stat(resolvedPath);
      const hasRange = Number.isFinite(Number(startLine)) || Number.isFinite(Number(endLine));
      if (!hasRange && Number(fileStat?.size || 0) > MAX_FILE_CONTENT_BYTES_PRECHECK) {
        return toToolJsonResult(TOOL_NAME.READ_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.readContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      const rawContent = await readFile(resolvedPath, "utf8");
      if (!hasRange && rawContent.length > MAX_FILE_CONTENT_CHARS) {
        return toToolJsonResult(TOOL_NAME.READ_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.readContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      const allLines = splitLines(rawContent);
      if (rawContent.endsWith("\n")) allLines.pop();
      const totalLines = allLines.length;
      const start = toPositiveInt(startLine, 1, 1, Math.max(1, totalLines));
      const requestedEnd = Number.isFinite(Number(endLine))
        ? toPositiveInt(endLine, totalLines, 1, Math.max(1, totalLines))
        : totalLines;
      const lineLimit = toPositiveInt(maxLines, DEFAULT_READ_MAX_LINES, 1, 5000);
      const end = Math.min(Math.max(start, requestedEnd), start + lineLimit - 1, totalLines);
      const selectedLines = allLines.slice(start - 1, end);
      const content = includeLineNumbers
        ? formatLinesWithNumbers(selectedLines, start)
        : selectedLines.join("\n");
      const truncated = end < requestedEnd || end < totalLines;
      if (content.length > MAX_FILE_CONTENT_CHARS) {
        return toToolJsonResult(TOOL_NAME.READ_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.readContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      return toToolJsonResult(TOOL_NAME.READ_FILE, {
        ok: true,
        resolvedPath,
        fileName: path.basename(resolvedPath),
        startLine: start,
        endLine: end,
        totalLines,
        includeLineNumbers: includeLineNumbers !== false,
        truncated,
        content,
      });
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.WRITE_FILE,
    description: tTool(agentContext, "tools.file.writeDescription"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.writeFilePathField")),
      content: z.string().describe(tTool(agentContext, "tools.file.writeContentField")),
      overwrite: z.boolean().optional().default(true).describe(tTool(agentContext, "tools.file.writeOverwriteField")),
    }),
    func: async ({ filePath, content, overwrite = true }) => {
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
      });
      if (overwrite === false && await exists(resolvedPath)) {
        return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
          ok: false,
          message: "file exists; set overwrite=true to replace it",
          resolvedPath,
          fileName: path.basename(resolvedPath),
        });
      }
      if (String(content || "").length > MAX_FILE_CONTENT_CHARS) {
        let transferPayload = {};
        if (typeof transferSemanticContent === "function") {
          try {
            const transferred = await transferSemanticContent({
              scenario: "tool",
              direction: "input",
              text: String(content || ""),
              inlineMaxChars: MAX_FILE_CONTENT_CHARS,
              name: `${path.basename(resolvedPath)}.tool-input.txt`,
              mimeType: "text/plain",
              source: TRANSFER_SOURCE.TOOL,
              reason: TRANSFER_REASON.WRITE_FILE_INPUT_TOO_LONG,
              meta: {
                toolName: TOOL_NAME.WRITE_FILE,
                field: "content",
                resolvedPath,
              },
            });
            transferPayload =
              transferred?.compactToolPayload &&
              typeof transferred.compactToolPayload === "object"
                ? transferred.compactToolPayload
                : {};
          } catch {
            transferPayload = {};
          }
        }
        return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
          ok: false,
          message: tTool(agentContext, "tools.file.writeContentTooLong"),
          resolvedPath,
          fileName: path.basename(resolvedPath),
          ...transferPayload,
        });
      }
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        resolvedPath,
        fileName: path.basename(resolvedPath),
      });
    },
  });

  const searchTool = new DynamicStructuredTool({
    name: TOOL_NAME.SEARCH,
    description: tTool(agentContext, "tools.search.description"),
    schema: z.object({
      source: z.enum(["files", "text"]).optional().default("files").describe(tTool(agentContext, "tools.search.fieldSource")),
      query: z.string().describe(tTool(agentContext, "tools.search.fieldQuery")),
      isRegex: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.search.fieldIsRegex")),
      caseSensitive: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.search.fieldCaseSensitive")),
      path: z.string().optional().describe(tTool(agentContext, "tools.search.fieldPath")),
      glob: z.string().optional().describe(tTool(agentContext, "tools.search.fieldGlob")),
      text: z.string().optional().describe(tTool(agentContext, "tools.search.fieldText")),
      contextLines: z.number().int().optional().default(DEFAULT_SEARCH_CONTEXT_LINES).describe(tTool(agentContext, "tools.search.fieldContextLines")),
      maxResults: z.number().int().optional().default(DEFAULT_SEARCH_MAX_RESULTS).describe(tTool(agentContext, "tools.search.fieldMaxResults")),
    }),
    func: async ({ source = "files", query, isRegex = false, caseSensitive = false, path: inputPath = ".", glob = "", text = "", contextLines = DEFAULT_SEARCH_CONTEXT_LINES, maxResults = DEFAULT_SEARCH_MAX_RESULTS }) => {
      const normalizedSource = String(source || "files").trim() === "text" ? "text" : "files";
      const normalizedQuery = String(query || "");
      if (!normalizedQuery) {
        return toToolJsonResult(TOOL_NAME.SEARCH, { ok: false, message: "query is required" });
      }
      if (normalizedSource === "text") {
        const normalizedText = String(text || "");
        if (normalizedText.length > MAX_SEARCH_TEXT_CHARS) {
          return toToolJsonResult(TOOL_NAME.SEARCH, { ok: false, message: "text is too long; search in smaller chunks" });
        }
        const result = searchInText({ text: normalizedText, query: normalizedQuery, isRegex, caseSensitive, contextLines, maxResults });
        return toToolJsonResult(TOOL_NAME.SEARCH, {
          ok: true,
          source: "text",
          query: normalizedQuery,
          ...result,
        });
      }

      const searchRoot = await assertAndResolveUserWorkspaceFilePath({
        filePath: inputPath || ".",
        agentContext,
        fieldName: "path",
        mustExist: true,
      });
      const workspacePath = await assertAndResolveUserWorkspaceFilePath({
        filePath: ".",
        agentContext,
        fieldName: "workspace",
        mustExist: true,
      });
      const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);
      let fastSearchResult = null;
      if (await hasRipgrep()) {
        try {
          fastSearchResult = await searchFilesWithRipgrep({
            rootPath: searchRoot,
            workspacePath,
            query: normalizedQuery,
            isRegex,
            caseSensitive,
            glob,
            contextLines,
            maxResults: maxCount,
          });
        } catch {
          fastSearchResult = null;
        }
      }
      let matches = Array.isArray(fastSearchResult?.matches)
        ? fastSearchResult.matches
        : [];
      let truncated = fastSearchResult?.truncated === true;
      if (!fastSearchResult) {
        const files = await collectSearchFiles({
          rootPath: searchRoot,
          workspacePath,
          glob,
        });
        matches = [];
        for (const file of files) {
          if (matches.length >= maxCount) break;
          let content = "";
          try {
            content = await readFile(file.filePath, "utf8");
          } catch {
            continue;
          }
          const result = searchInText({
            text: content,
            query: normalizedQuery,
            isRegex,
            caseSensitive,
            contextLines,
            maxResults: maxCount - matches.length,
            filePath: file.relativePath,
          });
          matches.push(...result.matches);
        }
        truncated = matches.length >= maxCount;
      }
      return toToolJsonResult(TOOL_NAME.SEARCH, {
        ok: true,
        source: "files",
        query: normalizedQuery,
        path: inputPath || ".",
        glob: String(glob || ""),
        matches,
        truncated,
      });
    },
  });

  const patchFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.PATCH_FILE,
    description: tTool(agentContext, "tools.patch_file.description"),
    schema: z.object({
      format: z.enum(["apply_patch", "unified_diff"]).optional().default("apply_patch").describe(tTool(agentContext, "tools.patch_file.fieldFormat")),
      patch: z.string().describe(tTool(agentContext, "tools.patch_file.fieldPatch")),
      strip: z.number().int().optional().default(1).describe(tTool(agentContext, "tools.patch_file.fieldStrip")),
      dryRun: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.patch_file.fieldDryRun")),
    }),
    func: async ({ format = "apply_patch", patch = "", strip = 1, dryRun = false }) => {
      const normalizedFormat = String(format || "apply_patch").trim() === "unified_diff" ? "unified_diff" : "apply_patch";
      const parsed = normalizedFormat === "unified_diff"
        ? parseUnifiedDiff(patch, strip)
        : parseApplyPatch(patch);
      const targets = await resolvePatchTargets({ patches: parsed, agentContext });
      const writePlans = [];
      const deletePlans = [];
      for (const item of targets) {
        if (item.mode === "add") {
          if (await exists(item.resolvedNewPath)) {
            throw recoverableToolError(`target file already exists: ${item.newPath}`, {
              code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
              details: { field: "patch", filePath: item.newPath },
            });
          }
          const content = Object.prototype.hasOwnProperty.call(item, "content")
            ? item.content
            : applyUnifiedHunks("", item.hunks || []);
          writePlans.push({ filePath: item.resolvedNewPath, content, displayPath: item.newPath });
          continue;
        }
        if (item.mode === "delete") {
          deletePlans.push({ filePath: item.resolvedOldPath, displayPath: item.oldPath });
          continue;
        }
        const original = await readFile(item.resolvedOldPath, "utf8");
        const nextContent = normalizedFormat === "unified_diff"
          ? applyUnifiedHunks(original, item.hunks || [])
          : applySearchHunks(original, item.hunks || []);
        const outputPath = item.resolvedNewPath || item.resolvedOldPath;
        writePlans.push({ filePath: outputPath, content: nextContent, displayPath: item.newPath || item.oldPath });
        if (item.mode === "move" && item.resolvedOldPath !== outputPath) {
          deletePlans.push({ filePath: item.resolvedOldPath, displayPath: item.oldPath });
        }
      }
      if (!dryRun) {
        for (const plan of writePlans) {
          await mkdir(path.dirname(plan.filePath), { recursive: true });
          await writeFile(plan.filePath, plan.content, "utf8");
        }
        for (const plan of deletePlans) {
          if (writePlans.some((item) => item.filePath === plan.filePath)) continue;
          await unlink(plan.filePath);
        }
      }
      return toToolJsonResult(TOOL_NAME.PATCH_FILE, {
        ok: true,
        format: normalizedFormat,
        dryRun: dryRun === true,
        changedFiles: writePlans.map((item) => item.displayPath),
        deletedFiles: deletePlans.map((item) => item.displayPath),
      });
    },
  });

  return [readFileTool, writeFileTool, searchTool, patchFileTool];
}
