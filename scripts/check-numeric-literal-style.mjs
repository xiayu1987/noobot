#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Numeric literal style guard:
 * - Use plain decimal digits for numeric literals.
 * - Do not use JavaScript numeric separators such as 18_000_000.
 *
 * This intentionally scans code tokens only, so strings like model names
 * (for example GLM_5_1) and comments are ignored.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, "package.json")) && exists(path.join(cwd, "scripts"))) return cwd;
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "package.json")) && exists(path.join(parent, "scripts"))) return parent;
  return cwd;
}

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

const ROOT = resolveRepoRoot();
const TARGET_DIRS = ["agent", "service", "agent-proxy", "model-proxy", "client", "plugin", "workflow", "i18n"];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}out${path.sep}`,
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isTokenChar(char = "") {
  return /[\w.]/.test(char);
}

function scanCodeTokens(filePath, text) {
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
    if (char === "\"" || char === "'") {
      state = "string";
      quote = char;
      continue;
    }
    if (char === "`") {
      state = "template";
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
      violations.push({
        file: toPosix(path.relative(ROOT, filePath)),
        line: tokenLine,
        column: tokenColumn,
        token,
      });
    }
    column += end - index - 1;
    index = end - 1;
  }

  return violations;
}

const files = [];
for (const dir of TARGET_DIRS) {
  const full = path.join(ROOT, dir);
  if (!exists(full)) continue;
  walk(full, files);
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  violations.push(...scanCodeTokens(file, text));
}

if (violations.length) {
  console.error("[check-numeric-literal-style] numeric separators are not allowed in code literals:");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line}:${item.column} ${item.token}`);
  }
  console.error("\nUse plain digits instead, for example 18000000 rather than 18_000_000.");
  process.exit(1);
}

console.log("[check-numeric-literal-style] ok");
