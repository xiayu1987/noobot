/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = [
  "agent/src",
  "agent-proxy/agent-proxy.js",
  "agent-proxy/src",
  "client/mac/src",
  "client/noobot-chat/src",
  "client/shared/electron",
  "client/shared/path-resolver.js",
  "client/startup/src",
  "client/windows/src",
  "i18n/src",
  "model-proxy/src",
  "plugin/noobot-plugin-harness/frontend",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/frontend",
  "plugin/noobot-plugin-workflow/src",
  "runtime-events/src",
  "sanitize/src",
  "service/app.js",
  "service/bootstrap",
  "service/deps",
  "service/routes",
  "service/services",
  "service/ws",
  "shared",
  "workflow/src",
];
const ignoredDirectories = new Set([
  ".git",
  "__tests__",
  "assets",
  "build",
  "coverage",
  "dist",
  "examples",
  "generated",
  "node_modules",
  "scripts",
  "test",
  "tests",
]);
const sourceExtension = /\.(?:[cm]?js|jsx|ts|tsx|vue)$/i;
const requiredHeaderLines = [
  "Copyright (c) 2026 xiayu",
  "Contact: 126240622+xiayu1987@users.noreply.github.com",
  "SPDX-License-Identifier: MIT",
];
const violations = [];
let inspectedFileCount = 0;

function inspect(relativePath) {
  if (!sourceExtension.test(relativePath)) return;
  inspectedFileCount += 1;
  const prefix = fs.readFileSync(path.join(root, relativePath), "utf8").slice(0, 1024);
  const missingLines = requiredHeaderLines.filter((line) => !prefix.includes(line));
  if (missingLines.length) {
    violations.push(`${relativePath}: missing ${missingLines.join("; ")}`);
  }
}

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const entry = fs.statSync(absolutePath);
  if (entry.isFile()) {
    inspect(relativePath);
    return;
  }
  for (const child of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (child.isDirectory() && ignoredDirectories.has(child.name)) continue;
    const childPath = path.join(relativePath, child.name).replaceAll("\\", "/");
    if (child.isDirectory()) walk(childPath);
    else if (child.isFile()) inspect(childPath);
  }
}

for (const sourceRoot of sourceRoots) walk(sourceRoot);

if (violations.length) {
  console.error(`Source files must contain the standard license header:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log(`Source license header guard passed (${inspectedFileCount} source files).`);
