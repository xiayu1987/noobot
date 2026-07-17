#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIR = "plugin/noobot-plugin-workflow/src";
const FILE_EXT = new Set([".js"]);
const DIRECT_KEY_CALL_RE = /tWorkflow\s*\(\s*[^,]+,\s*["']workflow[A-Za-z0-9_]+["']/g;

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

const absDir = path.resolve(ROOT, TARGET_DIR);
const files = walkFiles(absDir);
const problems = [];
for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (relPath === "plugin/noobot-plugin-workflow/src/core/i18n.js") continue;
  const text = fs.readFileSync(file, "utf8");
  const matches = [...text.matchAll(DIRECT_KEY_CALL_RE)].map((m) => String(m[0] || "").trim());
  if (matches.length) {
    problems.push({ file: relPath, matches });
  }
}

if (!problems.length) {
  console.log("✅ plugin workflow i18n keyset usage check passed.");
  process.exit(0);
}

console.error("❌ Found direct workflow i18n key strings outside i18n module:");
for (const item of problems) {
  console.error(`\n- ${item.file}`);
  item.matches.slice(0, 10).forEach((hit) => console.error(`  ${hit}`));
  if (item.matches.length > 10) {
    console.error(`  ... and ${item.matches.length - 10} more`);
  }
}
process.exit(1);
