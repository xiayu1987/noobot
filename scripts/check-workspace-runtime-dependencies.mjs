#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function readPackageJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const rootPackage = await readPackageJson(path.join(root, "package.json"));
const workspacePaths = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
const workspaces = await Promise.all(
  workspacePaths.map(async (workspacePath) => ({
    workspacePath,
    packageJson: await readPackageJson(path.join(root, workspacePath, "package.json")),
  })),
);
const internalPackageNames = new Set(
  workspaces.map(({ packageJson }) => String(packageJson.name || "").trim()).filter(Boolean),
);
const failures = [];

for (const { workspacePath, packageJson } of workspaces) {
  const runtimeDependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };
  for (const dependencyName of Object.keys(runtimeDependencies)) {
    if (!internalPackageNames.has(dependencyName)) continue;
    try {
      const installedPackage = await readPackageJson(
        path.join(root, "node_modules", ...dependencyName.split("/"), "package.json"),
      );
      if (installedPackage.name !== dependencyName) throw new Error("package identity mismatch");
    } catch {
      failures.push(`${workspacePath}: ${dependencyName}`);
    }
  }
}

if (failures.length) {
  console.error("Missing installed runtime workspace dependencies:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (!process.argv.includes("--quiet")) {
  console.log(`Workspace runtime dependency links are complete (${workspaces.length} workspaces).`);
}
