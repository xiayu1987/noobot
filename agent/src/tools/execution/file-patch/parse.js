/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizePathForPlatform } from "@noobot/path-resolver";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

const UNIFIED_ABSENT_PATH = "/dev/null";

function parseUnifiedHunkHeader(header = "") {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!match) {
    throw recoverableToolError(`invalid unified diff hunk header: ${header}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: "patch",
        hint: "Use a unified diff hunk header like @@ -1,3 +1,3 @@, or use apply_patch syntax with *** Begin Patch.",
      },
    });
  }
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] || "1"),
  };
}

export function normalizePatchPathInput(rawPath = "") {
  const trimmed = text(rawPath);
  if (!trimmed) return "";
  return normalizePathForPlatform(trimmed);
}

function resolveUnifiedPatchMode(oldPath, newPath) {
  if (newPath === UNIFIED_ABSENT_PATH) return "delete";
  if (oldPath === UNIFIED_ABSENT_PATH) return "add";
  return oldPath === newPath ? "update" : "move";
}

function buildAddedFileContent(contentLines) {
  return contentLines.join("\n") + (contentLines.length ? "\n" : "");
}

function readUnifiedAddedLines(hunks) {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const invalidIndex = lines.findIndex((line) => line.type !== "+");
  if (invalidIndex >= 0) {
    throw recoverableToolError("invalid unified diff add file line: expected + prefix", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch", line: invalidIndex + 1 },
    });
  }
  return lines.map((line) => line.text);
}

function buildUnifiedFilePatch({ oldPath, newPath, hunks }) {
  const mode = resolveUnifiedPatchMode(oldPath, newPath);
  if (mode === "add") {
    const content = buildAddedFileContent(readUnifiedAddedLines(hunks));
    return { mode, oldPath: "", newPath, hunks: [], content };
  }
  if (mode === "delete") return { mode, oldPath, newPath: "", hunks: [] };
  return { mode, oldPath, newPath, hunks };
}

function parseApplyPatchHunk(lines, startIndex) {
  let index = startIndex + 1;
  const hunkLines = [];
  while (
    index < lines.length &&
    !lines[index].startsWith("@@") &&
    !lines[index].startsWith("*** ")
  ) {
    const prefix = lines[index][0];
    if ([" ", "+", "-"].includes(prefix)) {
      hunkLines.push({ type: prefix, text: lines[index].slice(1) });
    }
    index += 1;
  }
  return { index, hunk: { lines: hunkLines } };
}

function stripDiffPath(rawPath, strip) {
  const pathToken = text(rawPath).split(/\s+/)[0] || "";
  const normalizedPath = normalizePatchPathInput(pathToken);
  if (!normalizedPath || normalizedPath === UNIFIED_ABSENT_PATH) return normalizedPath;
  if (isAbsoluteDiffPath(pathToken)) return normalizedPath;

  const parts = pathToken.replaceAll("\\", "/").split("/").filter(Boolean);
  if (strip >= parts.length) {
    throw recoverableToolError(`strip ${strip} removes the whole diff path: ${pathToken}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "strip", strip, path: pathToken },
    });
  }
  return normalizePatchPathInput(parts.slice(strip).join("/"));
}

function isAbsoluteDiffPath(value = "") {
  const source = text(value);
  return (
    source.startsWith("/") ||
    /^file:/i.test(source) ||
    /^[A-Za-z]:[\\/]/.test(source) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(source)
  );
}

function normalizePatchText(patch = "") {
  const inputText = String(patch || "").replace(/\r\n/g, "\n");
  const trimmed = inputText.trim();
  const fenced = /^```(?:diff|patch)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : inputText;
}

function isUnifiedFileHeader(lines, index) {
  return lines[index].startsWith("--- ") && Boolean(lines[index + 1]?.startsWith("+++ "));
}

function isUnifiedHunkBoundary(lines, index) {
  const line = lines[index];
  return (
    line.startsWith("@@") || line.startsWith("diff --git ") || isUnifiedFileHeader(lines, index)
  );
}

function parseUnifiedHunk(lines, startIndex) {
  const header =
    lines[startIndex].trim() === "@@" ? null : parseUnifiedHunkHeader(lines[startIndex]);
  const hunkLines = [];
  let index = startIndex + 1;
  for (; index < lines.length && !isUnifiedHunkBoundary(lines, index); index += 1) {
    if (lines[index] === "\\ No newline at end of file") continue;
    const prefix = lines[index][0];
    if (![" ", "+", "-"].includes(prefix)) break;
    hunkLines.push({ type: prefix, text: lines[index].slice(1) });
  }
  return {
    index,
    hunk: {
      ...header,
      searchOnly: !header,
      oldCount: hunkLines.filter((line) => line.type !== "+").length,
      newCount: hunkLines.filter((line) => line.type !== "-").length,
      lines: hunkLines,
    },
  };
}

function parseUnifiedFile(lines, startIndex, strip) {
  const oldPath = stripDiffPath(lines[startIndex].slice(4), strip);
  const newPath = stripDiffPath(lines[startIndex + 1].slice(4), strip);
  const hunks = [];
  let index = startIndex + 2;
  while (index < lines.length && !isUnifiedFileHeader(lines, index)) {
    if (!lines[index].startsWith("@@")) {
      index += 1;
      continue;
    }
    const parsed = parseUnifiedHunk(lines, index);
    hunks.push(parsed.hunk);
    index = parsed.index;
  }
  return { index, filePatch: buildUnifiedFilePatch({ oldPath, newPath, hunks }) };
}

export function parseUnifiedDiff(patch, strip) {
  const lines = normalizePatchText(patch).split("\n");
  const filePatches = [];
  let index = 0;
  while (index < lines.length) {
    if (!isUnifiedFileHeader(lines, index)) {
      index += 1;
      continue;
    }
    const parsed = parseUnifiedFile(lines, index, strip);
    filePatches.push(parsed.filePatch);
    index = parsed.index;
  }
  if (!filePatches.length) {
    throw recoverableToolError("invalid unified diff: no file patch found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return filePatches;
}

const APPLY_PATCH_ADD = "*** Add File: ";
const APPLY_PATCH_DELETE = "*** Delete File: ";
const APPLY_PATCH_UPDATE = "*** Update File: ";
const APPLY_PATCH_MOVE = "*** Move to: ";

function isApplyPatchSectionEnd(lines, index) {
  return index >= lines.length || lines[index].startsWith("*** ");
}

function parseApplyPatchAdd(lines, startIndex) {
  const newPath = lines[startIndex].slice(APPLY_PATCH_ADD.length).trim();
  const contentLines = [];
  let index = startIndex + 1;
  for (; !isApplyPatchSectionEnd(lines, index); index += 1) {
    if (!lines[index].startsWith("+")) {
      throw recoverableToolError("invalid apply_patch add file line: expected + prefix", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch" },
      });
    }
    contentLines.push(lines[index].slice(1));
  }
  const content = buildAddedFileContent(contentLines);
  return { index, patch: { mode: "add", oldPath: "", newPath, hunks: [], content } };
}

function parseApplyPatchDelete(lines, startIndex) {
  const oldPath = lines[startIndex].slice(APPLY_PATCH_DELETE.length).trim();
  return { index: startIndex + 1, patch: { mode: "delete", oldPath, newPath: "", hunks: [] } };
}

function parseApplyPatchUpdate(lines, startIndex) {
  const oldPath = lines[startIndex].slice(APPLY_PATCH_UPDATE.length).trim();
  let index = startIndex + 1;
  const moved = Boolean(lines[index]?.startsWith(APPLY_PATCH_MOVE));
  const newPath = moved ? lines[index].slice(APPLY_PATCH_MOVE.length).trim() : oldPath;
  if (moved) index += 1;
  const hunks = [];
  while (!isApplyPatchSectionEnd(lines, index)) {
    if (!lines[index].startsWith("@@")) {
      index += 1;
      continue;
    }
    const parsed = parseApplyPatchHunk(lines, index);
    hunks.push(parsed.hunk);
    index = parsed.index;
  }
  const mode = newPath === oldPath ? "update" : "move";
  return { index, patch: { mode, oldPath, newPath, hunks } };
}

const APPLY_PATCH_SECTION_PARSERS = Object.freeze([
  [APPLY_PATCH_ADD, parseApplyPatchAdd],
  [APPLY_PATCH_DELETE, parseApplyPatchDelete],
  [APPLY_PATCH_UPDATE, parseApplyPatchUpdate],
]);

function resolveApplyPatchSectionParser(line) {
  return APPLY_PATCH_SECTION_PARSERS.find(([marker]) => line.startsWith(marker))?.[1] || null;
}

export function parseApplyPatch(patch = "") {
  const lines = normalizePatchText(patch).split("\n");
  if (lines[0] !== "*** Begin Patch" || !lines.some((line) => line === "*** End Patch")) {
    throw recoverableToolError("invalid apply_patch: missing Begin/End Patch marker", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  const patches = [];
  let index = 1;
  while (index < lines.length && lines[index] !== "*** End Patch") {
    const parseSection = resolveApplyPatchSectionParser(lines[index]);
    if (!parseSection) {
      index += 1;
      continue;
    }
    const parsed = parseSection(lines, index);
    patches.push(parsed.patch);
    index = parsed.index;
  }
  if (!patches.length) {
    throw recoverableToolError("invalid apply_patch: no file operation found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return patches;
}
