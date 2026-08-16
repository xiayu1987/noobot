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
const SYSTEM_CORE_ROOT = path.join(SRC_ROOT, "system-core");

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
  "system-core",
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
const compatibilityFiles = walk(SYSTEM_CORE_ROOT).map(relativeToAgent);
if (compatibilityFiles.length !== 1 || compatibilityFiles[0] !== "src/system-core/index.js") {
  violations.push(
    `src/system-core is a compatibility facade and may contain only index.js; found: ${compatibilityFiles.join(", ") || "nothing"}`,
  );
}

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

const legacyPathPattern = /(?:agent\/)?(?:src|__tests__)\/system-core\/(?!index\.js)/g;
for (const filePath of [...walk(SRC_ROOT), ...walk(TEST_ROOT)]) {
  if (!/\.(?:[cm]?js|ts|tsx|json|md)$/.test(filePath)) continue;
  const content = readFileSync(filePath, "utf8");
  if (legacyPathPattern.test(content)) {
    violations.push(`legacy system-core path reference: ${relativeToAgent(filePath)}`);
  }
  legacyPathPattern.lastIndex = 0;
}

const packageJson = JSON.parse(readFileSync(path.join(AGENT_ROOT, "package.json"), "utf8"));
if (packageJson.exports?.["./bot-manage"] !== "./src/bot/index.js") {
  violations.push(
    "the noobot-agent/bot-manage compatibility export must resolve to src/bot/index.js",
  );
}
if (packageJson.exports?.["./system-core"] !== "./src/system-core/index.js") {
  violations.push(
    "the noobot-agent/system-core compatibility export must resolve to src/system-core/index.js",
  );
}

if (violations.length > 0) {
  console.error("[check-directory-boundaries] violations found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("[check-directory-boundaries] ok");
