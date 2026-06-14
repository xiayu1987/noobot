/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../core/check-tool-input.js";
import {
  isForbiddenWorkspaceRelativePath,
  normalizeSlash,
  splitLines,
  toPositiveInt,
} from "./file-utils.js";

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

function normalizePatchText(patch = "") {
  const text = String(patch || "").replace(/\r\n/g, "\n");
  const trimmed = text.trim();
  const fenced = /^```(?:diff|patch)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : text;
}

export function parseUnifiedDiff(patch = "", strip = 1) {
  const lines = normalizePatchText(patch).split("\n");
  const filePatches = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("--- ") || !lines[i + 1]?.startsWith("+++ ")) {
      i += 1;
      continue;
    }
    const oldPath = stripDiffPath(lines[i].slice(4), strip);
    const newPath = stripDiffPath(lines[i + 1].slice(4), strip);
    i += 2;
    const hunks = [];
    while (i < lines.length) {
      if (lines[i].startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
        break;
      }
      if (!lines[i].startsWith("@@")) {
        i += 1;
        continue;
      }
      const header = parseUnifiedHunkHeader(lines[i]);
      i += 1;
      const hunkLines = [];
      let oldSeen = 0;
      let newSeen = 0;
      while (i < lines.length && (oldSeen < header.oldCount || newSeen < header.newCount)) {
        if (lines[i] === "\\ No newline at end of file") {
          i += 1;
          continue;
        }
        const prefix = lines[i][0];
        if (![" ", "+", "-"].includes(prefix)) {
          break;
        }
        hunkLines.push({ type: prefix, text: lines[i].slice(1) });
        if (prefix !== "+") oldSeen += 1;
        if (prefix !== "-") newSeen += 1;
        i += 1;
      }
      if (oldSeen !== header.oldCount || newSeen !== header.newCount) {
        throw recoverableToolError("invalid unified diff: hunk body does not match header line counts", {
          code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
          details: {
            field: "patch",
            oldStart: header.oldStart,
            oldCount: header.oldCount,
            oldSeen,
            newStart: header.newStart,
            newCount: header.newCount,
            newSeen,
          },
        });
      }
      hunks.push({ ...header, lines: hunkLines });
    }
    filePatches.push({
      oldPath,
      newPath,
      hunks,
      mode: newPath === "/dev/null"
        ? "delete"
        : oldPath === "/dev/null"
          ? "add"
          : oldPath !== newPath
            ? "move"
            : "update",
    });
  }
  if (!filePatches.length) {
    throw recoverableToolError("invalid unified diff: no file patch found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return filePatches;
}

export function applyUnifiedHunks(originalContent = "", hunks = []) {
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
            details: {
              field: "patch",
              line: pointer + 1,
              expected: line.text,
              actual: originalLines[pointer],
            },
          });
        }
        output.push(line.text);
        pointer += 1;
      } else if (line.type === "-") {
        if (originalLines[pointer] !== line.text) {
          throw recoverableToolError("patch removal does not match target file", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: {
              field: "patch",
              line: pointer + 1,
              expected: line.text,
              actual: originalLines[pointer],
            },
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

export function parseApplyPatch(patch = "") {
  const lines = normalizePatchText(patch).split("\n");
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

export function applySearchHunks(originalContent = "", hunks = []) {
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
        details: {
          field: "patch",
          line: searchStart + 1,
          expected: oldPattern.join("\n"),
        },
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

export async function resolvePatchTargets({ patches = [], agentContext = {} } = {}) {
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
