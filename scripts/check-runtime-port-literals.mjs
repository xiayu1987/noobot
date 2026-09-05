#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, "package.json")) && exists(path.join(cwd, "scripts"))) return cwd;
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "package.json")) && exists(path.join(parent, "scripts"))) {
    return parent;
  }
  return cwd;
}

const ROOT = resolveRepoRoot();
const SOURCE_OF_TRUTH = "runtime-topology-protocol/src/ports.js";

/**
 * The only file allowed to hold runtime port literals: the frozen
 * RUNTIME_PORT_TOPOLOGY contract every other consumer derives from.
 */
const ALLOWED_FILES = new Set([SOURCE_OF_TRUTH]);

/**
 * Test fixtures assert against concrete ports on purpose; they are expectations,
 * not configuration defaults, so they are out of scope for this guard.
 */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "__tests__",
  "test",
  "tests",
  "dist",
  "build",
  "coverage",
  ".cache",
  "runtime",
]);

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".vue", ".sh", ".json"]);
const SCANNED_FILE_NAMES = new Set([".env.example"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/i;
const PORT_LITERAL = /\b1006[0-9]\b/;

function collectFiles(directory, results = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      collectFiles(absolute, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (TEST_FILE.test(entry.name)) continue;
    if (!SCANNED_EXTENSIONS.has(path.extname(entry.name)) && !SCANNED_FILE_NAMES.has(entry.name)) {
      continue;
    }
    results.push(absolute);
  }
  return results;
}

function scan(absolute) {
  const relativePath = path.relative(ROOT, absolute).split(path.sep).join("/");
  if (ALLOWED_FILES.has(relativePath)) return [];
  const violations = [];
  readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (PORT_LITERAL.test(line)) {
        violations.push({ file: relativePath, line: index + 1, text: line.trim() });
      }
    });
  return violations;
}

const files = collectFiles(ROOT);
const violations = files.flatMap((file) => scan(file));

if (violations.length > 0) {
  console.error(`Runtime port literals must live only in ${SOURCE_OF_TRUTH}.`);
  console.error("Derive them from @noobot/runtime-topology-protocol instead.\n");
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log(
  `check:runtime-port-literals passed (${files.length} files scanned, source of truth: ${SOURCE_OF_TRUTH})`,
);
