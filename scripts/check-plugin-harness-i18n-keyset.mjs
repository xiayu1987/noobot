#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIR = "plugin/noobot-plugin-harness/src";
const FILE_EXT = new Set([".js"]);
const DIRECT_KEY_CALL_RE = /translateI18nText\s*\(\s*[^,]+,\s*["'][A-Za-z0-9_]+["']/g;

const DIRECT_KEY_ALLOWED_FILES = new Set([
  "plugin/noobot-plugin-harness/src/i18n.js",
]);

function walkFiles(dir) {
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!FILE_EXT.has(path.extname(entry.name))) continue;
      result.push(abs);
    }
  }
  return result;
}

const absTargetDir = path.resolve(ROOT, TARGET_DIR);
const files = walkFiles(absTargetDir);
const problems = [];
for (const absPath of files) {
  const relPath = path.relative(ROOT, absPath);
  if (DIRECT_KEY_ALLOWED_FILES.has(relPath)) continue;
  const text = fs.readFileSync(absPath, "utf8");
  const matches = [...text.matchAll(DIRECT_KEY_CALL_RE)].map((m) => String(m[0] || "").trim());
  if (matches.length) problems.push({ file: relPath, matches });
}

if (!problems.length) {
  console.log("✅ plugin harness i18n keyset check passed.");
  process.exit(0);
}

console.error("❌ Found direct harness i18n key strings outside allowlisted migration files:");
for (const item of problems) {
  console.error(`\n- ${item.file}`);
  item.matches.forEach((hit) => console.error(`  ${hit}`));
}
process.exit(1);
