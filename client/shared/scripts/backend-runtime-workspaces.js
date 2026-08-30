/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import { clientFilePath as path } from "../path-resolver.js";

export const DESKTOP_BACKEND_ENTRY_WORKSPACES = Object.freeze([
  "service",
  "agent-proxy",
  "model-proxy",
  "plugin/noobot-plugin-harness",
  "plugin/noobot-plugin-workflow",
  "plugin/noobot-plugin-character",
]);

async function readPackageJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function resolveDesktopBackendRuntimeWorkspaces({
  repoRoot,
  entryWorkspaces = DESKTOP_BACKEND_ENTRY_WORKSPACES,
} = {}) {
  const rootPackage = await readPackageJson(path.join(repoRoot, "package.json"));
  const workspacePaths = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  const packagesByPath = new Map();
  const workspacePathByPackageName = new Map();

  for (const workspacePath of workspacePaths) {
    const packageJson = await readPackageJson(path.join(repoRoot, workspacePath, "package.json"));
    const packageName = String(packageJson?.name || "").trim();
    if (!packageName) throw new Error(`Workspace package name is required: ${workspacePath}`);
    packagesByPath.set(workspacePath, packageJson);
    workspacePathByPackageName.set(packageName, workspacePath);
  }

  const pending = [...entryWorkspaces];
  const included = new Set();
  while (pending.length) {
    const workspacePath = pending.shift();
    if (included.has(workspacePath)) continue;
    const packageJson = packagesByPath.get(workspacePath);
    if (!packageJson)
      throw new Error(`Desktop backend entry workspace is not declared: ${workspacePath}`);
    included.add(workspacePath);
    const runtimeDependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.optionalDependencies || {}),
    };
    for (const dependencyName of Object.keys(runtimeDependencies)) {
      const dependencyWorkspacePath = workspacePathByPackageName.get(dependencyName);
      if (dependencyWorkspacePath && !included.has(dependencyWorkspacePath)) {
        pending.push(dependencyWorkspacePath);
      }
    }
  }

  return workspacePaths.filter((workspacePath) => included.has(workspacePath));
}

function assertRuntimeWorkspacePath(value) {
  const workspacePath = String(value || "").trim();
  const segments = workspacePath.split(/[\\/]+/).filter(Boolean);
  if (
    !workspacePath ||
    path.isAbsolute(workspacePath) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `Invalid prepared backend runtime workspace path: ${workspacePath || "<empty>"}`,
    );
  }
  return workspacePath;
}

function installedPackageJsonPath(packageName) {
  const name = String(packageName || "").trim();
  const segments = name.split("/").filter(Boolean);
  if (!name || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid prepared backend runtime package name: ${name || "<empty>"}`);
  }
  return path.join("node_modules", ...segments, "package.json");
}

export async function assertPreparedBackendRuntimeWorkspaces({ backendRoot, label } = {}) {
  const runtimePackage = await readPackageJson(path.join(backendRoot, "package.json"));
  if (!Array.isArray(runtimePackage.workspaces) || runtimePackage.workspaces.length === 0) {
    throw new Error("Prepared backend runtime workspace manifest is required");
  }
  const requiredFiles = [];
  for (const value of runtimePackage.workspaces) {
    const workspacePath = assertRuntimeWorkspacePath(value);
    const sourcePackagePath = path.join(workspacePath, "package.json");
    let workspacePackage;
    try {
      workspacePackage = await readPackageJson(path.join(backendRoot, sourcePackagePath));
    } catch (error) {
      throw new Error(
        `Missing required backend runtime workspace after ${label}: ${sourcePackagePath}`,
        { cause: error },
      );
    }
    requiredFiles.push(sourcePackagePath, installedPackageJsonPath(workspacePackage.name));
  }
  await Promise.all(
    requiredFiles.map(async (relativePath) => {
      try {
        await stat(path.join(backendRoot, relativePath));
      } catch (error) {
        throw new Error(
          `Missing required backend runtime workspace after ${label}: ${relativePath}`,
          { cause: error },
        );
      }
    }),
  );
  return Object.freeze([...requiredFiles]);
}
