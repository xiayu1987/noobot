/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const FIRST_PARTY_AUXILIARY_ROOTS = Object.freeze(["scripts", "user-template"]);

export const FIRST_PARTY_IGNORED_DIRECTORIES = Object.freeze([
  ".git",
  ".pm2",
  "__mocks__",
  "__tests__",
  "assets",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "report",
  "test-results",
  "tests",
  "vendor",
  "workspace",
]);

export const FIRST_PARTY_IGNORED_GLOBS = Object.freeze([
  ...FIRST_PARTY_IGNORED_DIRECTORIES.map((directory) => `**/${directory}/**`),
  "**/*.test.{js,mjs,cjs,jsx,ts,tsx}",
  "**/*.spec.{js,mjs,cjs,jsx,ts,tsx}",
]);

const ignoredDirectorySet = new Set(FIRST_PARTY_IGNORED_DIRECTORIES);
const testFilePattern = /\.(?:test|spec)\.(?:[cm]?js|jsx|ts|tsx)$/i;

async function readRootWorkspacePaths(repositoryRoot) {
  const packagePath = path.join(repositoryRoot, "package.json");
  const rootPackage = JSON.parse(await readFile(packagePath, "utf8"));
  const workspaceEntries = Array.isArray(rootPackage?.workspaces) ? rootPackage.workspaces : [];
  const unsupported = workspaceEntries.filter((entry) => /[*?{}[\]]/.test(String(entry || "")));
  if (unsupported.length) {
    throw new Error(
      `quality source inventory requires explicit workspace paths: ${unsupported.join(", ")}`,
    );
  }
  return workspaceEntries.map((entry) => String(entry || "").trim()).filter(Boolean);
}

export async function getFirstPartySourceRoots({ repositoryRoot } = {}) {
  const normalizedRoot = path.resolve(repositoryRoot || path.resolve(import.meta.dirname, "../.."));
  const workspaceRoots = await readRootWorkspacePaths(normalizedRoot);
  return [...new Set([...workspaceRoots, ...FIRST_PARTY_AUXILIARY_ROOTS])].sort();
}

export function isFirstPartyProductionPath(relativePath = "") {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || testFilePattern.test(normalized)) return false;
  return !normalized.split("/").some((segment) => ignoredDirectorySet.has(segment));
}

async function collectDirectoryFiles({ repositoryRoot, relativeDirectory, extensions, output }) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectorySet.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectDirectoryFiles({
        repositoryRoot,
        relativeDirectory: relativePath,
        extensions,
        output,
      });
      continue;
    }
    if (!entry.isFile() || !isFirstPartyProductionPath(relativePath)) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extensions.has(extension)) output.add(path.normalize(relativePath));
  }
}

export async function getFirstPartyProductionFiles({
  repositoryRoot,
  extensions = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
} = {}) {
  const normalizedRoot = path.resolve(repositoryRoot || path.resolve(import.meta.dirname, "../.."));
  const sourceRoots = await getFirstPartySourceRoots({ repositoryRoot: normalizedRoot });
  const extensionSet = new Set(extensions.map((extension) => String(extension).toLowerCase()));
  const output = new Set();
  for (const relativeDirectory of sourceRoots) {
    await collectDirectoryFiles({
      repositoryRoot: normalizedRoot,
      relativeDirectory,
      extensions: extensionSet,
      output,
    });
  }
  return [...output].sort();
}
