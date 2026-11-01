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

function consumeNonCode(cursor, char, next) {
  if (cursor.state === "blockComment") {
    if (char === "*" && next === "/") {
      cursor.index += 1;
      cursor.column += 1;
      cursor.state = "code";
    }
    return true;
  }
  if (cursor.state === "lineComment") return true;
  if (cursor.state !== "string" && cursor.state !== "template") return false;
  if (char === "\\") {
    cursor.index += 1;
    cursor.column += 1;
    return true;
  }
  if (char === cursor.quote) {
    cursor.state = "code";
    cursor.quote = "";
  }
  return true;
}

function openNonCode(cursor, char, next) {
  if (char === "/" && (next === "*" || next === "/")) {
    cursor.index += 1;
    cursor.column += 1;
    cursor.state = next === "*" ? "blockComment" : "lineComment";
    return true;
  }
  if (char !== '"' && char !== "'" && char !== "`") return false;
  cursor.state = char === "`" ? "template" : "string";
  cursor.quote = char;
  return true;
}

function consumeToken(cursor, text, matches) {
  const start = cursor.index;
  let end = start + 1;
  while (end < text.length && matches(text[end])) end += 1;
  cursor.column += end - start - 1;
  cursor.index = end - 1;
  return text.slice(start, end);
}

function advanceLine(cursor) {
  cursor.line += 1;
  cursor.column = 0;
  if (cursor.state === "lineComment") cursor.state = "code";
}

export function scanCodeTokens(file, text) {
  const violations = [];
  const cursor = { state: "code", quote: "", line: 1, column: 0, index: 0 };
  for (; cursor.index < text.length; cursor.index += 1) {
    const char = text[cursor.index];
    const next = text[cursor.index + 1];
    cursor.column += 1;
    if (char === "\n") {
      advanceLine(cursor);
      continue;
    }
    if (consumeNonCode(cursor, char, next) || openNonCode(cursor, char, next)) continue;
    if (isIdentifierStart(char)) {
      consumeToken(cursor, text, isIdentifierChar);
      continue;
    }
    if (!isDigit(char)) continue;
    const { line, column } = cursor;
    const token = consumeToken(cursor, text, isTokenChar);
    if (/\d_\d/.test(token)) {
      violations.push({ file, line, column, token });
    }
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
