#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectoryNames = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const ignoredWorkspaceOutputNames = new Set(["logs", "workspace"]);

async function readPackageJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function findMjsFiles(directory, workspaceRoot, results = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const isWorkspaceOutput =
        directory === workspaceRoot && ignoredWorkspaceOutputNames.has(entry.name);
      if (!ignoredDirectoryNames.has(entry.name) && !isWorkspaceOutput) {
        await findMjsFiles(absolutePath, workspaceRoot, results);
      }
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === ".mjs") results.push(absolutePath);
  }
  return results;
}

const rootPackage = await readPackageJson(path.join(root, "package.json"));
const workspacePaths = Array.isArray(rootPackage.workspaces)
  ? rootPackage.workspaces
  : rootPackage.workspaces?.packages || [];
const violations = [];

for (const workspacePath of workspacePaths) {
  const workspaceRoot = path.join(root, workspacePath);
  const workspacePackage = await readPackageJson(path.join(workspaceRoot, "package.json"));
  if (workspacePackage.type !== "module") continue;
  violations.push(...(await findMjsFiles(workspaceRoot, workspaceRoot)));
}

if (violations.length) {
  console.error('ES module workspaces must use ".js" under their package-level "type": "module":');
  for (const filePath of violations.sort()) {
    console.error(`- ${path.relative(root, filePath).split(path.sep).join("/")}`);
  }
  process.exit(1);
}

if (!process.argv.includes("--quiet")) {
  console.log(`Workspace module extensions are canonical (${workspacePaths.length} workspaces).`);
}
