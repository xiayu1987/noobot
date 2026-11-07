/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { adaptPatchHunks, decodePatchText, encodePatchText } from "@noobot/file-mutation-protocol";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";

function invalid(message, details = {}) {
  throw recoverableToolError(message, {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: { field: "patch", ...details },
  });
}

function oldTexts(hunk) {
  return hunk.lines.filter((line) => line.type !== "+").map((line) => line.text);
}

function matchedPrefix(lines, pattern, start) {
  let count = 0;
  while (count < pattern.length && lines[start + count] === pattern[count]) count += 1;
  return count;
}

function locateHunk(lines, hunk, cursor) {
  const pattern = oldTexts(hunk);
  if (hunk.anchorLine !== undefined) {
    const start = hunk.anchorLine - 1;
    if (!Number.isSafeInteger(start) || start < cursor || start > lines.length) {
      invalid("patch hunks overlap or are out of order", {
        line: start + 1,
        cursorLine: cursor + 1,
        anchorLine: hunk.anchorLine,
      });
    }
    const matched = matchedPrefix(lines, pattern, start);
    if (matched !== pattern.length) {
      invalid("patch hunk context does not match target file", {
        line: start + matched + 1,
        expected: pattern[matched],
        actual: lines[start + matched],
      });
    }
    return start;
  }
  if (!pattern.length) invalid("insertion without old context requires an exact line anchor");
  const candidates = [];
  let best = { start: cursor, count: 0 };
  for (let start = cursor; start <= lines.length - pattern.length; start += 1) {
    const count = matchedPrefix(lines, pattern, start);
    if (count > best.count) best = { start, count };
    if (count === pattern.length) candidates.push(start);
  }
  if (candidates.length > 1) {
    invalid("patch hunk context matches multiple locations", {
      candidateLines: candidates.map((start) => start + 1),
      hint: "Use continuous unique context or @@ L<exact original start line>.",
    });
  }
  if (candidates.length === 1) return candidates[0];
  invalid(
    "patch hunk context does not match target file",
    best.count
      ? {
          line: best.start + best.count + 1,
          expected: pattern[best.count],
          actual: lines[best.start + best.count],
        }
      : { expected: pattern.join("\n"), cursorLine: cursor + 1 },
  );
}

function validateOldNewlines(oldLines, start, source) {
  oldLines.forEach((line, index) => {
    const position = start + index;
    const missing = position === source.lines.length - 1 && !source.finalNewline;
    if (Boolean(line.noFinalNewline) !== missing) {
      invalid("unified diff old newline declaration does not match source", {
        line: position + 1,
        declaredFinalNewline: !line.noFinalNewline,
        actualFinalNewline: !missing,
      });
    }
  });
}

function resolveUnifiedNewlines({
  hunk,
  start,
  source,
  oldCount,
  newLines,
  outputStart,
  newEofPositions,
  finalNewline,
}) {
  if (!hunk.unified) return finalNewline;
  validateOldNewlines(
    hunk.lines.filter((line) => line.type !== "+"),
    start,
    source,
  );
  if (!oldCount && start === source.lines.length && source.lines.length && !source.finalNewline) {
    invalid("appending after an unterminated line requires its old context");
  }
  newLines.forEach((line, index) => {
    if (line.noFinalNewline) newEofPositions.push(outputStart + index + 1);
  });
  return start + oldCount === source.lines.length ? !newLines.at(-1)?.noFinalNewline : finalNewline;
}

function appendSourceLines({ source, start, end, output, outputEndings }) {
  for (let index = start; index < end; index += 1) {
    output.push(source.lines[index]);
    outputEndings.push(source.endings[index]);
  }
}

function appendHunkLines({ hunk, source, start, output, outputEndings }) {
  let oldPosition = start;
  for (const line of hunk.lines) {
    if (line.type !== "-") {
      output.push(line.text);
      outputEndings.push(line.type === " " ? source.endings[oldPosition] : source.ending);
    }
    if (line.type !== "+") oldPosition += 1;
  }
}

export function applyPatchHunks(originalContent, hunks, contentEncoding = "raw") {
  let adapted;
  try {
    adapted = adaptPatchHunks(hunks, contentEncoding);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    invalid(error.message);
  }
  const source = decodePatchText(originalContent);
  const { bom, ending, lines } = source;
  let finalNewline = source.finalNewline;
  const output = [];
  const outputEndings = [];
  const newEofPositions = [];
  let cursor = 0;
  for (const hunk of adapted.hunks) {
    const start = locateHunk(lines, hunk, cursor);
    const oldCount = oldTexts(hunk).length;
    const newLines = hunk.lines.filter((line) => line.type !== "-");
    finalNewline = resolveUnifiedNewlines({
      hunk,
      start,
      source,
      oldCount,
      newLines,
      outputStart: output.length + start - cursor,
      newEofPositions,
      finalNewline,
    });
    appendSourceLines({ source, start: cursor, end: start, output, outputEndings });
    appendHunkLines({ hunk, source, start, output, outputEndings });
    cursor = start + oldCount;
  }
  appendSourceLines({ source, start: cursor, end: lines.length, output, outputEndings });
  if (newEofPositions.some((position) => position !== output.length)) {
    invalid("unified diff new no-newline marker is not at final EOF");
  }
  if (newEofPositions.length) finalNewline = false;
  return {
    content: encodePatchText({ bom, lines: output, endings: outputEndings, ending, finalNewline }),
    adaptations: adapted.adaptations,
  };
}
