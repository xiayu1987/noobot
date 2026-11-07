/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizePathForPlatform } from "@noobot/path-resolver";
import {
  PATCH_LINE_ANCHOR_PATTERN,
  assertFileText,
  validateUnifiedNewlineMarkers,
} from "@noobot/file-mutation-protocol";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

function invalid(message, line) {
  throw recoverableToolError(message, {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: { field: "patch", ...(line === undefined ? {} : { patchLine: line + 1 }) },
  });
}

export function normalizePatchPathInput(rawPath = "") {
  const trimmed = text(rawPath);
  return trimmed ? normalizePathForPlatform(trimmed) : "";
}

function patchLines(patch) {
  return assertFileText(patch).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
}

function requireChange(hunk, index) {
  if (!hunk.lines.some((line) => line.type === "+" || line.type === "-")) {
    invalid("patch hunk must contain a change", index);
  }
  return hunk;
}

function bodyLine(line, index) {
  if (![" ", "+", "-"].includes(line[0]))
    invalid("invalid patch body line: expected space, + or - prefix", index);
  return { type: line[0], text: line.slice(1) };
}

function requiredPath(value, index) {
  const path = normalizePatchPathInput(value);
  if (!path) invalid("patch file path must not be empty", index);
  return path;
}

function parseApplyHunk(lines, start) {
  const header = lines[start];
  const match = PATCH_LINE_ANCHOR_PATTERN.exec(header);
  if (header !== "@@" && (!match || !Number.isSafeInteger(Number(match[1])))) {
    invalid(`invalid apply_patch hunk header: ${header}; use @@ or @@ L<line>`, start);
  }
  const hunk = { ...(match ? { anchorLine: Number(match[1]) } : {}), lines: [] };
  let index = start + 1;
  while (
    index < lines.length &&
    !lines[index].startsWith("@@") &&
    !lines[index].startsWith("*** ")
  ) {
    hunk.lines.push(bodyLine(lines[index], index));
    index += 1;
  }
  return { index, hunk: requireChange(hunk, start) };
}

function parseAddedContent(lines, start) {
  const contentLines = [];
  let index = start;
  while (index < lines.length && !lines[index].startsWith("*** ")) {
    if (!lines[index].startsWith("+"))
      invalid("invalid apply_patch add file line: expected + prefix", index);
    contentLines.push(lines[index++].slice(1));
  }
  return { index, content: contentLines.join("\n") + (contentLines.length ? "\n" : "") };
}

export function parseApplyPatch(patch = "") {
  const lines = patchLines(patch);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    invalid("invalid apply_patch: missing Begin/End Patch marker or trailing content");
  }
  const patches = [];
  let index = 1;
  while (index < lines.length - 1) {
    const match = /^\*\*\* (Add|Delete|Update) File: (.*)$/.exec(lines[index]);
    if (!match) invalid(`invalid apply_patch section: ${lines[index]}`, index);
    const path = requiredPath(match[2], index);
    index += 1;
    if (match[1] === "Delete") {
      patches.push({ mode: "delete", oldPath: path, newPath: "", hunks: [] });
      continue;
    }
    if (match[1] === "Add") {
      const added = parseAddedContent(lines, index);
      index = added.index;
      patches.push({ mode: "add", oldPath: "", newPath: path, hunks: [], content: added.content });
      continue;
    }
    let newPath = path;
    if (lines[index]?.startsWith("*** Move to: ")) {
      newPath = requiredPath(lines[index].slice(13), index);
      index += 1;
    }
    const hunks = [];
    while (index < lines.length && !lines[index].startsWith("*** ")) {
      const parsed = parseApplyHunk(lines, index);
      hunks.push(parsed.hunk);
      index = parsed.index;
    }
    if (!hunks.length && newPath === path)
      invalid("update requires at least one changed hunk", index);
    patches.push({ mode: newPath === path ? "update" : "move", oldPath: path, newPath, hunks });
  }
  if (!patches.length) invalid("invalid apply_patch: no file operation found");
  return patches;
}

function stripDiffPath(rawPath, strip) {
  const token = rawPath.split("\t")[0];
  const normalized = requiredPath(token);
  if (normalized === "/dev/null" || /^(?:\/|file:|[A-Za-z]:[\\/]|\\\\)/i.test(token))
    return normalized;
  const parts = token.replaceAll("\\", "/").split("/").filter(Boolean);
  if (strip >= parts.length) invalid(`strip ${strip} removes the whole diff path: ${token}`);
  return normalizePatchPathInput(parts.slice(strip).join("/"));
}

function unifiedHeader(lines, index) {
  return lines[index]?.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ");
}

function parseUnifiedRange(lines, start) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[start]);
  if (!match) invalid(`invalid unified diff hunk header: ${lines[start]}`, start);
  const oldStart = Number(match[1]);
  const oldCount = Number(match[2] ?? 1);
  const newStart = Number(match[3]);
  const newCount = Number(match[4] ?? 1);
  if (
    ![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) ||
    (oldCount > 0 && oldStart === 0) ||
    (newCount > 0 && newStart === 0)
  ) {
    invalid("invalid unified diff line range", start);
  }
  return { oldStart, oldCount, newStart, newCount };
}

function markNoFinalNewline(hunk, index) {
  if (!hunk.lines.length || hunk.lines.at(-1).noFinalNewline)
    invalid("invalid no-newline marker", index);
  hunk.lines.at(-1).noFinalNewline = true;
}

function parseUnifiedHunk(lines, start) {
  const range = parseUnifiedRange(lines, start);
  const { oldStart, oldCount, newCount } = range;
  const hunk = { unified: true, anchorLine: oldCount === 0 ? oldStart + 1 : oldStart, lines: [] };
  let index = start + 1;
  let oldSeen = 0;
  let newSeen = 0;
  while (index < lines.length && (oldSeen < oldCount || newSeen < newCount)) {
    if (lines[index] === "\\ No newline at end of file") {
      markNoFinalNewline(hunk, index);
      index += 1;
      continue;
    }
    const line = bodyLine(lines[index], index);
    hunk.lines.push(line);
    if (line.type !== "+") oldSeen += 1;
    if (line.type !== "-") newSeen += 1;
    if (oldSeen > oldCount || newSeen > newCount)
      invalid("unified diff hunk counts do not match body", index);
    index += 1;
  }
  if (lines[index] === "\\ No newline at end of file") {
    markNoFinalNewline(hunk, index);
    index += 1;
  }
  if (oldSeen !== oldCount || newSeen !== newCount)
    invalid("unified diff hunk counts do not match body", start);
  return { index, hunk: requireChange(hunk, start), ...range };
}

function parseUnifiedHunks(lines, start) {
  const hunks = [];
  let index = start;
  let delta = 0;
  while (lines[index]?.startsWith("@@")) {
    const parsed = parseUnifiedHunk(lines, index);
    const oldPosition = parsed.oldCount === 0 ? parsed.oldStart : parsed.oldStart - 1;
    const newPosition = parsed.newCount === 0 ? parsed.newStart : parsed.newStart - 1;
    if (newPosition !== oldPosition + delta)
      invalid("unified diff new range conflicts with old range", index);
    delta += parsed.newCount - parsed.oldCount;
    hunks.push(parsed.hunk);
    index = parsed.index;
  }
  if (!hunks.length) invalid("unified diff requires at least one hunk", index);
  try {
    validateUnifiedNewlineMarkers(hunks);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    invalid(error.message, index);
  }
  return { hunks, index };
}

function unifiedOperation(oldPath, newPath, hunks) {
  const allLines = hunks.flatMap((hunk) => hunk.lines);
  if (oldPath === "/dev/null" && newPath === "/dev/null")
    invalid("unified diff requires a file path");
  if (oldPath === "/dev/null") {
    if (
      allLines.some((line) => line.type !== "+") ||
      hunks.length !== 1 ||
      hunks[0].anchorLine !== 1
    )
      invalid("invalid unified diff add file lines");
    return {
      mode: "add",
      oldPath: "",
      newPath,
      hunks: [],
      content:
        allLines.map((line) => line.text).join("\n") +
        (allLines.at(-1)?.noFinalNewline ? "" : "\n"),
    };
  }
  if (newPath === "/dev/null") {
    if (allLines.some((line) => line.type !== "-"))
      invalid("invalid unified diff delete file lines");
    return { mode: "delete", oldPath, newPath: "", hunks };
  }
  return { mode: oldPath === newPath ? "update" : "move", oldPath, newPath, hunks };
}

export function parseUnifiedDiff(patch, strip = 0) {
  const lines = patchLines(patch);
  const patches = [];
  let index = 0;
  while (index < lines.length) {
    if (
      lines[index].startsWith("diff --git ") ||
      /^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$/.test(lines[index])
    ) {
      index += 1;
      continue;
    }
    if (!unifiedHeader(lines, index))
      invalid(`invalid unified diff file header: ${lines[index]}`, index);
    const oldPath = stripDiffPath(lines[index].slice(4), strip);
    const newPath = stripDiffPath(lines[index + 1].slice(4), strip);
    const parsed = parseUnifiedHunks(lines, index + 2);
    patches.push(unifiedOperation(oldPath, newPath, parsed.hunks));
    index = parsed.index;
  }
  if (!patches.length) invalid("invalid unified diff: no file patch found");
  return patches;
}
