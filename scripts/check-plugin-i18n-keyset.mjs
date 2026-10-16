#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { text } from "@noobot/shared/value";

const ROOT = process.cwd();
const PLUGIN_RULES = [
  {
    name: "harness",
    sourceDir: "plugin/noobot-plugin-harness/src",
    i18nModule: "plugin/noobot-plugin-harness/src/i18n.js",
    directKeyCall: /translateI18nText\s*\(\s*[^,]+,\s*["'][A-Za-z0-9_]+["']/g,
  },
  {
    name: "workflow",
    sourceDir: "plugin/noobot-plugin-workflow/src",
    i18nModule: "plugin/noobot-plugin-workflow/src/core/i18n.js",
    directKeyCall: /tWorkflow\s*\(\s*[^,]+,\s*["']workflow[A-Za-z0-9_]+["']/g,
  },
];

function walkJsFiles(dir) {
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && path.extname(entry.name) === ".js") result.push(abs);
    }
  }
  return result;
}

const problems = [];
for (const rule of PLUGIN_RULES) {
  for (const absPath of walkJsFiles(path.resolve(ROOT, rule.sourceDir))) {
    const relPath = path.relative(ROOT, absPath);
    if (relPath === rule.i18nModule) continue;
    const source = fs.readFileSync(absPath, "utf8");
    const matches = [...source.matchAll(rule.directKeyCall)].map((match) => text(match[0]));
    if (matches.length) problems.push({ plugin: rule.name, file: relPath, matches });
  }
}

if (!problems.length) {
  console.log("✅ plugin i18n keyset check passed.");
  process.exit(0);
}

console.error("❌ Found direct plugin i18n key strings outside the plugin i18n module:");
for (const item of problems) {
  console.error(`\n- [${item.plugin}] ${item.file}`);
  item.matches.forEach((hit) => console.error(`  ${hit}`));
}
process.exit(1);
