#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "../path-resolver.js";

const sharedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set(["node_modules", "startup", "tests"]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectSourceFiles(file, files);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

const sourceFiles = collectSourceFiles(sharedRoot).sort();
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`[client-shared] syntax ok: ${sourceFiles.length} source files`);
