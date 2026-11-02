/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import { LINE_NUMBER_PREFIX_PATTERN, splitLines } from "../file-utils.js";

const PATCH_REPAIR_KIND = Object.freeze({
  LINE_NUMBER_PREFIX_STRIPPED: "line_number_prefix_stripped",
});

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

function readOriginalLines(textFormat) {
  const lines = splitLines(textFormat.content);
  if (textFormat.hadFinalNewline) lines.pop();
  return lines;
}

function joinPatchedLines(lines, textFormat) {
  return (
    textFormat.byteOrderMark +
    lines.join(textFormat.lineEnding) +
    (textFormat.hadFinalNewline ? textFormat.lineEnding : "")
  );
}

function isOldLine(line) {
  return line.type === " " || line.type === "-";
}

function oldTexts(hunkLines) {
  return hunkLines.filter(isOldLine).map((line) => line.text);
}

function countMatchedPrefix(lines, pattern, start) {
  let matched = 0;
  while (matched < pattern.length && lines[start + matched] === pattern[matched]) matched += 1;
  return matched;
}

function matchesAt(lines, pattern, start) {
  return countMatchedPrefix(lines, pattern, start) === pattern.length;
}

function stripLineNumberPrefixes(hunkLines, originalLines) {
  const oldLines = hunkLines.filter(isOldLine);
  if (!oldLines.length) return null;
  const prefixes = oldLines.map((line) => LINE_NUMBER_PREFIX_PATTERN.exec(line.text));
  if (prefixes.some((match) => !match)) return null;
  const firstLine = Number(prefixes[0][1]);
  const consistent = prefixes.every((match, index) => {
    const lineNumber = Number(match[1]);
    return (
      lineNumber === firstLine + index &&
      originalLines[lineNumber - 1] === oldLines[index].text.slice(match[0].length)
    );
  });
  if (!consistent) return null;
  const prefixedAddition = hunkLines.find(
    (line) => line.type === "+" && LINE_NUMBER_PREFIX_PATTERN.test(line.text),
  );
  if (prefixedAddition) {
    throw recoverableToolError("patch added line carries a read_file line-number prefix", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: "patch",
        line: firstLine,
        actual: prefixedAddition.text,
        hint: "Added lines have no source line number; write them without the line-number prefix.",
      },
    });
  }
  return {
    start: firstLine - 1,
    lines: hunkLines.map((line) =>
      line.type === "+"
        ? line
        : { ...line, text: line.text.replace(LINE_NUMBER_PREFIX_PATTERN, "") },
    ),
    repair: {
      kind: PATCH_REPAIR_KIND.LINE_NUMBER_PREFIX_STRIPPED,
      line: firstLine,
      lineCount: oldLines.length,
    },
  };
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

function resolveUnifiedHunkLines({ hunk, originalLines, hunkStart, repairs }) {
  if (matchesAt(originalLines, oldTexts(hunk.lines), hunkStart)) return hunk.lines;
  const repaired = stripLineNumberPrefixes(hunk.lines, originalLines);
  if (!repaired || repaired.start !== hunkStart) return hunk.lines;
  repairs.push(repaired.repair);
  return repaired.lines;
}

export function applyUnifiedHunks(originalContent, hunks) {
  const textFormat = readTextFormat(originalContent);
  const originalLines = readOriginalLines(textFormat);
  const output = [];
  const repairs = [];
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
    const lines = resolveUnifiedHunkLines({ hunk, originalLines, hunkStart, repairs });
    pointer = applyUnifiedHunkLines({ lines, originalLines, output, pointer: hunkStart });
  }
  output.push(...originalLines.slice(pointer));
  return { content: joinPatchedLines(output, textFormat), repairs };
}

function findFullMatches(lines, pattern, searchStart) {
  const starts = [];
  for (let start = searchStart; start <= lines.length - pattern.length; start += 1) {
    if (matchesAt(lines, pattern, start)) starts.push(start);
  }
  return starts;
}

function findBestPartialMatch(lines, pattern, searchStart) {
  let best = { start: -1, matched: 0 };
  for (let start = searchStart; start <= lines.length - pattern.length; start += 1) {
    const matched = countMatchedPrefix(lines, pattern, start);
    if (matched > best.matched) best = { start, matched };
  }
  return best;
}

function hunkMismatchDetails(lines, pattern, candidate) {
  const details = { field: "patch", expected: pattern.join("\n") };
  if (candidate.matched === 0) return details;
  const mismatchIndex = candidate.start + candidate.matched;
  return {
    ...details,
    line: mismatchIndex + 1,
    expected: pattern[candidate.matched],
    actual: lines[mismatchIndex],
  };
}

function nearestStart(starts, anchorLine) {
  const target = anchorLine - 1;
  return starts.reduce((best, start) =>
    Math.abs(start - target) < Math.abs(best - target) ? start : best,
  );
}

function locateSearchHunk({ originalLines, hunk, searchStart, repairs }) {
  const pattern = oldTexts(hunk.lines);
  if (!pattern.length) {
    return { start: hunk.anchorLine ? hunk.anchorLine - 1 : searchStart, lines: hunk.lines };
  }
  const starts = findFullMatches(originalLines, pattern, searchStart);
  if (starts.length === 1) return { start: starts[0], lines: hunk.lines };
  if (starts.length > 1) {
    if (hunk.anchorLine) return { start: nearestStart(starts, hunk.anchorLine), lines: hunk.lines };
    throw recoverableToolError("apply_patch hunk context matches multiple locations", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: "patch",
        candidateLines: starts.map((start) => start + 1),
        hint: "Add a line anchor such as @@ L42 to choose the intended location.",
      },
    });
  }
  const repaired = stripLineNumberPrefixes(hunk.lines, originalLines);
  if (repaired && repaired.start >= searchStart) {
    repairs.push(repaired.repair);
    return { start: repaired.start, lines: repaired.lines };
  }
  throw recoverableToolError("apply_patch hunk context does not match target file", {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: hunkMismatchDetails(
      originalLines,
      pattern,
      findBestPartialMatch(originalLines, pattern, searchStart),
    ),
  });
}

export function applySearchHunks(originalContent, hunks) {
  const textFormat = readTextFormat(originalContent);
  const originalLines = readOriginalLines(textFormat);
  const output = [];
  const repairs = [];
  let searchStart = 0;
  for (const hunk of hunks) {
    const located = locateSearchHunk({ originalLines, hunk, searchStart, repairs });
    if (located.start < searchStart || located.start > originalLines.length) {
      throw recoverableToolError("patch hunks overlap or are out of order", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch", line: located.start + 1 },
      });
    }
    const newBlock = located.lines.filter((line) => line.type !== "-").map((line) => line.text);
    output.push(...originalLines.slice(searchStart, located.start), ...newBlock);
    searchStart = located.start + oldTexts(located.lines).length;
  }
  output.push(...originalLines.slice(searchStart));
  return { content: joinPatchedLines(output, textFormat), repairs };
}
