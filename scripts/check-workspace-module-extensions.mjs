#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { readPackageJson, readRootWorkspacePaths } from "./quality/source-inventory.mjs";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const IGNORED_WORKSPACE_OUTPUT_NAMES = new Set(["logs", "workspace"]);

async function findMjsFiles(directory, workspaceRoot, results) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const isWorkspaceOutput =
        directory === workspaceRoot && IGNORED_WORKSPACE_OUTPUT_NAMES.has(entry.name);
      if (!IGNORED_DIRECTORY_NAMES.has(entry.name) && !isWorkspaceOutput) {
        await findMjsFiles(absolutePath, workspaceRoot, results);
      }
    } else if (entry.isFile() && path.extname(entry.name) === ".mjs") {
      results.push(absolutePath);
    }
  }
  return results;
}

export async function measureWorkspaceModuleExtensions(root) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const workspacePath of await readRootWorkspacePaths(root)) {
    const workspaceRoot = path.join(root, workspacePath);
    const workspacePackage = await readPackageJson(path.join(workspaceRoot, "package.json"));
    if (workspacePackage.type !== "module") continue;
    for (const filePath of await findMjsFiles(workspaceRoot, workspaceRoot, [])) {
      addHit(measured.mjsInModuleWorkspace, {
        file: path.relative(root, filePath).split(path.sep).join("/"),
        message: '.mjs file under package-level "type": "module"',
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "workspace-module-extensions",
  description: 'ES module workspaces use ".js" under their package-level "type": "module"',
  rules: {
    mjsInModuleWorkspace: {
      description: 'A workspace with "type": "module" contains a .mjs file',
      hint: 'rename the file to ".js"; the package type already selects ESM',
    },
  },
  exemptions: [],
  baseline: { mjsInModuleWorkspace: 0, exemptions: 0 },
  measure: () => measureWorkspaceModuleExtensions(repositoryRoot),
});

await runCheckWhenMain(CHECK, import.meta.url);
