/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function consumeQuotedCharacter(line, index, state) {
  const character = line[index];
  if (character === "\\") return { index: index + 1, state };
  if (character === state.quote) return { index, state: { mode: "code", quote: "" } };
  return { index, state };
}

const COMMENT_CLOSERS = Object.freeze({ blockComment: "*/", htmlComment: "-->" });

function consumeCommentCharacter(line, index, state) {
  const closer = COMMENT_CLOSERS[state.mode];
  if (!line.startsWith(closer, index)) return { index, state };
  return { index: index + closer.length - 1, state: { mode: "code", quote: "" } };
}

function scanEffectiveLine(line, initialState) {
  let state = initialState;
  let hasCode = state.mode === "string" || state.mode === "template";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const pair = line.slice(index, index + 2);
    if (Object.hasOwn(COMMENT_CLOSERS, state.mode)) {
      const consumed = consumeCommentCharacter(line, index, state);
      state = consumed.state;
      index = consumed.index;
      continue;
    }
    if (state.mode === "string" || state.mode === "template") {
      const consumed = consumeQuotedCharacter(line, index, state);
      state = consumed.state;
      index = consumed.index;
      continue;
    }
    if (pair === "//") break;
    if (pair === "/*") {
      state = { mode: "blockComment", quote: "" };
      index += 1;
      continue;
    }
    if (line.slice(index, index + 4) === "<!--") {
      state = { mode: "htmlComment", quote: "" };
      index += 3;
      continue;
    }
    if (character === '"' || character === "'") {
      hasCode = true;
      state = { mode: "string", quote: character };
      continue;
    }
    if (character === "`") {
      hasCode = true;
      state = { mode: "template", quote: "`" };
      continue;
    }
    if (!/\s/.test(character)) hasCode = true;
  }
  return { hasCode, state };
}

export function countEffectiveCodeLines(source = "") {
  let state = { mode: "code", quote: "" };
  let count = 0;
  for (const line of String(source).split(/\r?\n/)) {
    const result = scanEffectiveLine(line, state);
    state = result.state;
    if (result.hasCode) count += 1;
  }
  return count;
}
