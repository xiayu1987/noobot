/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizePathForPlatform } from "../../../utils/path-resolver.js";
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { toPositiveInt } from "../file-utils.js";

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

function normalizePatchPathInput(rawPath = "") {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  return normalizePathForPlatform(trimmed);
}

function stripDiffPath(rawPath = "", strip = 1) {
  const withoutTimestamp = normalizePatchPathInput(String(rawPath || "").trim().split(/\s+/)[0] || "");
  if (!withoutTimestamp || withoutTimestamp === "/dev/null") return withoutTimestamp;
  const parts = withoutTimestamp.split("/").filter(Boolean);
  if (/^[A-Za-z]:$/.test(parts[0] || "")) return withoutTimestamp;
  // Absolute paths (sandbox-absolute like /project or /workspace, or host-absolute)
  // are preserved verbatim and handed to the shared resolver; the numeric strip
  // only applies to relative diff prefixes such as git a/ and b/.
  if (withoutTimestamp.startsWith("/")) return withoutTimestamp;
  const stripCount = toPositiveInt(strip, 1, 0, 10);
  return parts.slice(stripCount).join("/") || withoutTimestamp;
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
      const header = lines[i].trim() === "@@" ? null : parseUnifiedHunkHeader(lines[i]);
      i += 1;
      const hunkLines = [];
      let oldSeen = 0;
      let newSeen = 0;
      while (i < lines.length) {
        if (lines[i] === "\\ No newline at end of file") {
          i += 1;
          continue;
        }
        if (lines[i].startsWith("@@") || lines[i].startsWith("diff --git ")) break;
        if (lines[i].startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) break;
        const prefix = lines[i][0];
        if (![" ", "+", "-"].includes(prefix)) break;
        hunkLines.push({ type: prefix, text: lines[i].slice(1) });
        if (prefix !== "+") oldSeen += 1;
        if (prefix !== "-") newSeen += 1;
        i += 1;
      }
      hunks.push({
        ...(header || {}),
        searchOnly: !header,
        oldCount: oldSeen,
        newCount: newSeen,
        declaredOldCount: header?.oldCount || oldSeen,
        declaredNewCount: header?.newCount || newSeen,
        lines: hunkLines,
      });
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
