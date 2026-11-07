/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function linesOf(value) {
  const lines = String(value).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function updateScores(scores, oldLine, newLines, direction) {
  let diagonal = 0;
  for (let column = 1; column <= newLines.length; column += 1) {
    const previous = scores[column];
    const index = direction === 1 ? column - 1 : newLines.length - column;
    scores[column] =
      oldLine === newLines[index] ? diagonal + 1 : Math.max(previous, scores[column - 1]);
    diagonal = previous;
  }
}

function lcsScores(oldLines, newLines, direction) {
  const scores = new Uint32Array(newLines.length + 1);
  for (let row = 0; row < oldLines.length; row += 1) {
    const index = direction === 1 ? row : oldLines.length - row - 1;
    updateScores(scores, oldLines[index], newLines, direction);
  }
  return scores;
}

function splitColumn(left, right, newLines) {
  const forward = lcsScores(left, newLines, 1);
  const backward = lcsScores(right, newLines, -1);
  let best = -1;
  let split = 0;
  for (let column = 0; column <= newLines.length; column += 1) {
    const score = forward[column] + backward[newLines.length - column];
    if (score > best) {
      best = score;
      split = column;
    }
  }
  return split;
}

function matchMiddle({ oldLines, newLines, oldOffset, newOffset, matches }) {
  if (!oldLines.length || !newLines.length) return;
  if (oldLines.length === 1) {
    const column = newLines.indexOf(oldLines[0]);
    if (column !== -1) matches.push([oldOffset, newOffset + column]);
    return;
  }
  const values = new Set(oldLines);
  if (!newLines.some((line) => values.has(line))) return;
  const middle = Math.floor(oldLines.length / 2);
  const left = oldLines.slice(0, middle);
  const right = oldLines.slice(middle);
  const column = splitColumn(left, right, newLines);
  matchLines({
    oldLines: left,
    newLines: newLines.slice(0, column),
    oldOffset,
    newOffset,
    matches,
  });
  matchLines({
    oldLines: right,
    newLines: newLines.slice(column),
    oldOffset: oldOffset + middle,
    newOffset: newOffset + column,
    matches,
  });
}

function matchLines({ oldLines, newLines, oldOffset, newOffset, matches }) {
  let prefix = 0;
  while (
    prefix < Math.min(oldLines.length, newLines.length) &&
    oldLines[prefix] === newLines[prefix]
  ) {
    matches.push([oldOffset + prefix, newOffset + prefix]);
    prefix += 1;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  matchMiddle({
    oldLines: oldLines.slice(prefix, oldEnd),
    newLines: newLines.slice(prefix, newEnd),
    oldOffset: oldOffset + prefix,
    newOffset: newOffset + prefix,
    matches,
  });
  for (let index = 0; index < oldLines.length - oldEnd; index += 1) {
    matches.push([oldOffset + oldEnd + index, newOffset + newEnd + index]);
  }
}

export function createFileDiff(before = "", after = "") {
  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  const matches = [];
  matchLines({ oldLines, newLines, oldOffset: 0, newOffset: 0, matches });
  matches.push([oldLines.length, newLines.length]);
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [oldMatch, newMatch] of matches) {
    while (oldIndex < oldMatch) {
      rows.push({
        type: "removed",
        oldLine: oldIndex + 1,
        newLine: null,
        text: oldLines[oldIndex++],
      });
    }
    while (newIndex < newMatch) {
      rows.push({
        type: "added",
        oldLine: null,
        newLine: newIndex + 1,
        text: newLines[newIndex++],
      });
    }
    if (oldIndex < oldLines.length) {
      rows.push({
        type: "context",
        oldLine: ++oldIndex,
        newLine: ++newIndex,
        text: oldLines[oldMatch],
      });
    }
  }
  const additions = newLines.length - matches.length + 1;
  const deletions = oldLines.length - matches.length + 1;
  return {
    format: "git-lines-v1",
    additions,
    deletions,
    changedLines: additions + deletions,
    lines: rows,
  };
}
