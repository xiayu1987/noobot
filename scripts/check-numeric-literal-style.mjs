#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isTokenChar(char) {
  return /[\w.]/.test(char);
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierChar(char) {
  return /[\w$]/.test(char);
}

export function scanCodeTokens(file, text) {
  const violations = [];
  let state = "code";
  let quote = "";
  let line = 1;
  let column = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    column += 1;

    if (char === "\n") {
      line += 1;
      column = 0;
      if (state === "lineComment") state = "code";
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        index += 1;
        column += 1;
        state = "code";
      }
      continue;
    }

    if (state === "lineComment") continue;

    if (state === "string") {
      if (char === "\\") {
        index += 1;
        column += 1;
        continue;
      }
      if (char === quote) {
        state = "code";
        quote = "";
      }
      continue;
    }

    if (state === "template") {
      if (char === "\\") {
        index += 1;
        column += 1;
        continue;
      }
      if (char === "`") state = "code";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 1;
      column += 1;
      state = "blockComment";
      continue;
    }
    if (char === "/" && next === "/") {
      index += 1;
      column += 1;
      state = "lineComment";
      continue;
    }
    if (char === '"' || char === "'") {
      state = "string";
      quote = char;
      continue;
    }
    if (char === "`") {
      state = "template";
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < text.length && isIdentifierChar(text[end])) end += 1;
      column += end - index - 1;
      index = end - 1;
      continue;
    }

    if (!isDigit(char)) continue;

    const tokenLine = line;
    const tokenColumn = column;
    const start = index;
    let end = index + 1;
    while (end < text.length && isTokenChar(text[end])) end += 1;
    const token = text.slice(start, end);
    if (/\d_\d/.test(token)) {
      violations.push({ file, line: tokenLine, column: tokenColumn, token });
    }
    column += end - index - 1;
    index = end - 1;
  }

  return violations;
}

export async function measureNumericLiteralStyle(files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    for (const { line, column, token } of scanCodeTokens(file, await readRepositoryText(file))) {
      addHit(measured.numericSeparator, { file, line, message: `column ${column} ${token}` });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "numeric-literal-style",
  description: "Numeric literals are written with plain digits",
  rules: {
    numericSeparator: {
      description: "Numeric literal uses an underscore separator",
      hint: "write plain digits, for example 18000000 rather than 18_000_000",
    },
  },
  exemptions: [],
  baseline: { numericSeparator: 0, exemptions: 0 },
  measure: async () =>
    measureNumericLiteralStyle(
      await getFirstPartyCodeFiles({
        repositoryRoot,
        extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
        includeTests: true,
      }),
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
