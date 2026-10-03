#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = path.join(AGENT_ROOT, "src");
const TEST_ROOT = path.join(AGENT_ROOT, "__tests__");

const EXPECTED_SOURCE_DIRECTORIES = new Set([
  "application",
  "artifacts",
  "bot",
  "config",
  "context",
  "events",
  "extensions",
  "integrations",
  "memory",
  "models",
  "observability",
  "prompts",
  "runtime",
  "sandbox",
  "session",
  "shared",
  "skills",
  "tools",
  "transfer-adapter",
  "transfer",
  "workspace-lifecycle",
]);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, files);
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function relativeToAgent(filePath) {
  return path.relative(AGENT_ROOT, filePath).split(path.sep).join("/");
}

const violations = [];

const actualSourceDirectories = readdirSync(SRC_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
for (const directory of actualSourceDirectories) {
  if (!EXPECTED_SOURCE_DIRECTORIES.has(directory)) {
    violations.push(`unclassified top-level source directory: src/${directory}`);
  }
}
for (const requiredDirectory of ["bot", "context", "runtime"]) {
  if (!actualSourceDirectories.includes(requiredDirectory)) {
    violations.push(`missing required semantic source directory: src/${requiredDirectory}`);
  }
}

const legacyPathPattern = /(?:agent\/)?(?:src|__tests__)\/system-core\//g;
for (const filePath of [...walk(SRC_ROOT), ...walk(TEST_ROOT)]) {
  if (!/\.(?:[cm]?js|ts|tsx|json|md)$/.test(filePath)) continue;
  const content = readFileSync(filePath, "utf8");
  if (legacyPathPattern.test(content)) {
    violations.push(`legacy system-core path reference: ${relativeToAgent(filePath)}`);
  }
  legacyPathPattern.lastIndex = 0;
}

const packageJson = JSON.parse(readFileSync(path.join(AGENT_ROOT, "package.json"), "utf8"));
for (const removedExport of ["./bot-manage", "./system-core"]) {
  if (Object.hasOwn(packageJson.exports || {}, removedExport)) {
    violations.push(`removed compatibility export must not be declared: ${removedExport}`);
  }
}

if (violations.length > 0) {
  console.error("[check-directory-boundaries] violations found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[check-directory-boundaries] ok");
