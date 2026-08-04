#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (statExists(path.join(cwd, "agent", "src"))) return cwd;
  if (path.basename(cwd) === "agent" && statExists(path.join(cwd, "src"))) {
    return path.dirname(cwd);
  }
  const parent = path.dirname(cwd);
  if (statExists(path.join(parent, "agent", "src"))) return parent;
  return cwd;
}

function statExists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

const ROOT = resolveRepoRoot();
const TARGET_ROOT = path.join(ROOT, "agent", "src");
const PLUGIN_ROOT = path.join(ROOT, "plugin");
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
];

const IMPORT_SPECIFIER_REGEX = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
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

function collectImportMatches(text = "", isViolation = () => false) {
  const matches = [];
  for (const match of text.matchAll(IMPORT_SPECIFIER_REGEX)) {
    const specifier = String(match[1] || "").trim();
    if (!isViolation(specifier)) continue;
    const offset = Number(match.index) || 0;
    const line = text.slice(0, offset).split(/\r?\n/).length;
    const sourceLine = text.split(/\r?\n/)[line - 1] || "";
    matches.push({ line, terms: [specifier], text: sourceLine.trim() });
  }
  return matches;
}

const violations = [];

for (const file of walk(TARGET_ROOT)) {
  const relPath = toPosix(path.relative(ROOT, file));
  const text = readFileSync(file, "utf8");
  const matches = collectImportMatches(text, (specifier) =>
    /(?:^|[/@])noobot-plugin-(?:harness|workflow)(?:[/]|$)/i.test(specifier) ||
    /(?:^|\/)plugin\/noobot-plugin-(?:harness|workflow)(?:\/|$)/i.test(specifier),
  );
  const count = matches.reduce((sum, item) => sum + item.terms.length, 0);
  if (!count) continue;
  violations.push({ relPath, count, matches });
}

if (statExists(PLUGIN_ROOT)) {
  for (const file of walk(PLUGIN_ROOT)) {
    const relPath = toPosix(path.relative(ROOT, file));
    const text = readFileSync(file, "utf8");
    const matches = collectImportMatches(text, (specifier) => /(?:^|\/)agent\/src\//.test(specifier));
    if (matches.length) violations.push({ relPath, count: matches.length, matches });
  }
}

if (violations.length) {
  console.error("[check-agent-plugin-decoupling] concrete plugin coupling violations found:");
  for (const item of violations) {
    console.error(`- ${item.relPath}: ${item.count}`);
    for (const match of item.matches.slice(0, 8)) {
      console.error(`  ${match.line}: ${match.text}`);
    }
    if (item.matches.length > 8) console.error(`  ... ${item.matches.length - 8} more matching lines`);
  }
  console.error("\nAgent core has no concrete-plugin compatibility allowlist; remove the coupling.");
  process.exit(1);
}

console.log("[check-agent-plugin-decoupling] ok");
