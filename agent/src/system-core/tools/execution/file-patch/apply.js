/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { splitLines } from "../file-utils.js";

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
