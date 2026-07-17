#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/**
 * parentSessionId unification guard
 *
 * Goal:
 * - Prevent new scattered parentSessionId fallback/normalization patterns
 *   outside explicitly allowed compatibility zones.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_ROOT = path.join(ROOT, "agent", "src", "system-core");

const ALLOW_PATH_PREFIXES = [
  "agent/src/system-core/session/",
];

const ALLOW_EXACT_FILES = new Set([
  "agent/src/system-core/context/parent-session-id-resolver.js",
  // business semantic fallback: child parent falls back to source session
  "agent/src/system-core/bot-manage/session/session-execution-engine.js",
]);

const RULES = [
  /String\(\s*parentSessionId\s*\|\|\s*""\s*\)\.trim\(\)/,
  /\(\s*parentSessionId\s*\?\?\s*""\s*\)\.trim\(\)/,
  /systemRuntime\?\.parentSessionId\s*\|\|/,
  /runtime\?\.parentSessionId\s*\|\|/,
];

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
      continue;
    }
    if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

function isAllowed(relPath = "") {
  if (ALLOW_EXACT_FILES.has(relPath)) return true;
  return ALLOW_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

const files = await walk(TARGET_ROOT);
const violations = [];
for (const file of files) {
  const relPath = file.replace(`${ROOT}/`, "");
  if (isAllowed(relPath)) continue;
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("parentSessionId")) continue;
    if (RULES.some((rule) => rule.test(line))) {
      violations.push({
        relPath,
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

if (violations.length) {
  console.error("[check-parent-sessionid-unification] violations found:");
  for (const item of violations) {
    console.error(`- ${item.relPath}:${item.line}: ${item.text}`);
  }
  process.exit(1);
}

console.log("[check-parent-sessionid-unification] ok");
