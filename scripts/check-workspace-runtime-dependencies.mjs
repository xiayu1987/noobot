#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { readPackageJson, readRootWorkspacePaths } from "./quality/source-inventory.mjs";

const RUNTIME_DEPENDENCY_FIELDS = Object.freeze(["dependencies", "optionalDependencies"]);

async function readInstalledPackage(root, dependencyName) {
  try {
    return await readPackageJson(
      path.join(root, "node_modules", ...dependencyName.split("/"), "package.json"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function runtimeDependencyNames(packageJson) {
  return RUNTIME_DEPENDENCY_FIELDS.flatMap((field) =>
    field in packageJson ? Object.keys(packageJson[field]) : [],
  );
}

export async function measureWorkspaceRuntimeDependencies(root) {
  const measured = emptyRuleMeasurements(CHECK);
  const workspacePaths = await readRootWorkspacePaths(root);
  const workspaces = await Promise.all(
    workspacePaths.map(async (workspacePath) => ({
      workspacePath,
      packageJson: await readPackageJson(path.join(root, workspacePath, "package.json")),
    })),
  );
  const internalPackageNames = new Set(workspaces.map(({ packageJson }) => packageJson.name));
  for (const { workspacePath, packageJson } of workspaces) {
    const file = `${workspacePath}/package.json`;
    for (const dependencyName of new Set(runtimeDependencyNames(packageJson))) {
      if (!internalPackageNames.has(dependencyName)) continue;
      const installed = await readInstalledPackage(root, dependencyName);
      if (!installed) {
        addHit(measured.missingLink, { file, message: `${dependencyName} is not installed` });
      } else if (installed.name !== dependencyName) {
        addHit(measured.identityMismatch, {
          file,
          message: `node_modules/${dependencyName} resolves to ${installed.name}`,
        });
      }
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "workspace-runtime-dependencies",
  description: "Every internal runtime dependency of a workspace is linked in node_modules",
  rules: {
    missingLink: {
      description: "An internal workspace dependency has no installed package.json",
      hint: "run npm install --workspaces from the repository root",
    },
    identityMismatch: {
      description: "An installed internal dependency declares a different package name",
      hint: "remove the stale node_modules entry and reinstall the workspaces",
    },
  },
  exemptions: [],
  baseline: { missingLink: 0, identityMismatch: 0, exemptions: 0 },
  measure: () => measureWorkspaceRuntimeDependencies(repositoryRoot),
});

await runCheckWhenMain(CHECK, import.meta.url);
