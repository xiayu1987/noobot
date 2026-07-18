/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["."];
const ignoredDirectories = new Set([
  ".git",
  "assets",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
  "workspace",
]);
const sourceExtension = /\.(?:[cm]?js|jsx|ts|tsx|vue)$/i;
const requiredHeaderLines = [
  "Copyright (c) 2026 xiayu",
  "Contact: 126240622+xiayu1987@users.noreply.github.com",
  "SPDX-License-Identifier: MIT",
];
const canonicalContact = "Contact: 126240622+xiayu1987@users.noreply.github.com";
const maskedContactLine = /^([ \t]*(?:\*|\/\/)?[ \t]*)Contact:[^\r\n]*x{3,}[^\r\n]*$/gim;
const violations = [];
let inspectedFileCount = 0;
let repairedFileCount = 0;

function inspect(relativePath) {
  if (!sourceExtension.test(relativePath)) return;
  inspectedFileCount += 1;
  const absolutePath = path.join(root, relativePath);
  let source = fs.readFileSync(absolutePath, "utf8");
  const prefix = source.slice(0, 1024);
  const repairedPrefix = prefix.replace(
    maskedContactLine,
    (_, linePrefix) => `${linePrefix}${canonicalContact}`,
  );
  if (repairedPrefix !== prefix) {
    source = repairedPrefix + source.slice(1024);
    fs.writeFileSync(absolutePath, source, "utf8");
    repairedFileCount += 1;
  }
  const missingLines = requiredHeaderLines.filter((line) => !repairedPrefix.includes(line));
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

const repairSummary = repairedFileCount ? `; repaired ${repairedFileCount} masked contact header(s)` : "";
console.log(`Source license header guard passed (${inspectedFileCount} source files${repairSummary}).`);
