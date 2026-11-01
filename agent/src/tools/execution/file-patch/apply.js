/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { splitLines } from "../file-utils.js";

function readTextFormat(originalContent) {
  const byteOrderMark = originalContent.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = byteOrderMark ? originalContent.slice(1) : originalContent;
  return {
    byteOrderMark,
    content,
    lineEnding: content.includes("\r\n") ? "\r\n" : "\n",
    hadFinalNewline: content.endsWith("\n"),
  };
}

function joinPatchedLines(lines, textFormat) {
  return (
    textFormat.byteOrderMark +
    lines.join(textFormat.lineEnding) +
    (textFormat.hadFinalNewline ? textFormat.lineEnding : "")
  );
}

function applyUnifiedHunkLines({ lines, originalLines, output, pointer }) {
  for (const line of lines) {
    if (line.type === "+") {
      output.push(line.text);
      continue;
    }
    if (line.type !== " " && line.type !== "-") continue;
    if (originalLines[pointer] !== line.text) {
      const message =
        line.type === " "
          ? "patch context does not match target file"
          : "patch removal does not match target file";
      throw recoverableToolError(message, {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: {
          field: "patch",
          line: pointer + 1,
          expected: line.text,
          actual: originalLines[pointer],
        },
      });
    }
    if (line.type === " ") output.push(line.text);
    pointer += 1;
  }
  return pointer;
}

export function applyUnifiedHunks(originalContent, hunks) {
  const textFormat = readTextFormat(originalContent);
  const originalLines = splitLines(textFormat.content);
  if (textFormat.hadFinalNewline) originalLines.pop();
  const output = [];
  let pointer = 0;
  for (const hunk of hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    if (hunkStart < pointer) {
      throw recoverableToolError("patch hunks overlap or are out of order", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch", line: hunkStart + 1 },
      });
    }
    output.push(...originalLines.slice(pointer, hunkStart));
    pointer = hunkStart;
    pointer = applyUnifiedHunkLines({ lines: hunk.lines, originalLines, output, pointer });
  }
  output.push(...originalLines.slice(pointer));
  return joinPatchedLines(output, textFormat);
}

function findSubsequence(lines = [], pattern = [], startIndex = 0) {
  if (!pattern.length) return Math.max(0, startIndex);
  for (let i = Math.max(0, startIndex); i <= lines.length - pattern.length; i += 1) {
    if (pattern.every((line, offset) => lines[i + offset] === line)) return i;
  }
  return -1;
}

export function applySearchHunks(originalContent, hunks) {
  const textFormat = readTextFormat(originalContent);
  const originalLines = splitLines(textFormat.content);
  if (textFormat.hadFinalNewline) originalLines.pop();
  let output = [...originalLines];
  let searchStart = 0;
  for (const hunk of hunks) {
    const oldPattern = hunk.lines
      .filter((line) => line.type === " " || line.type === "-")
      .map((line) => line.text);
    const newBlock = hunk.lines
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
    output = [...output.slice(0, hit), ...newBlock, ...output.slice(hit + oldPattern.length)];
    searchStart = hit + newBlock.length;
  }
  return joinPatchedLines(output, textFormat);
}
