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

function scanEffectiveLine(line, initialState) {
  let state = initialState;
  let hasCode = state.mode === "string" || state.mode === "template";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const pair = line.slice(index, index + 2);
    const htmlEnd = line.slice(index, index + 3);
    if (state.mode === "blockComment") {
      if (pair === "*/") {
        state = { mode: "code", quote: "" };
        index += 1;
      }
      continue;
    }
    if (state.mode === "htmlComment") {
      if (htmlEnd === "-->") {
        state = { mode: "code", quote: "" };
        index += 2;
      }
      continue;
    }
    if (state.mode === "string" || state.mode === "template") {
      if (!/\s/.test(character)) hasCode = true;
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
