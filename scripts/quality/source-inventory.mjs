/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_CHECK_IGNORE_NONE_MATCHED = 1;
const FIRST_PARTY_AUXILIARY_ROOTS = Object.freeze(["scripts", "user-template"]);

const FIRST_PARTY_IGNORED_DIRECTORIES = Object.freeze([
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
const testDirectorySet = new Set(["__mocks__", "__tests__", "tests"]);
const testFilePattern = /\.(?:test|spec)\.(?:[cm]?js|jsx|ts|tsx)$/i;

export async function readPackageJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readRootWorkspacePaths(repositoryRoot) {
  const { workspaces } = await readPackageJson(path.join(repositoryRoot, "package.json"));
  if (!Array.isArray(workspaces)) {
    throw new TypeError("root package.json workspaces must be an explicit path array");
  }
  const unsupported = workspaces.filter(
    (entry) => typeof entry !== "string" || !entry.trim() || /[*?{}[\]]/.test(entry),
  );
  if (unsupported.length) {
    throw new Error(
      `quality source inventory requires explicit workspace paths: ${unsupported.join(", ")}`,
    );
  }
  return workspaces;
}

export async function getFirstPartySourceRoots({ repositoryRoot } = {}) {
  const normalizedRoot = path.resolve(repositoryRoot || path.resolve(import.meta.dirname, "../.."));
  const workspaceRoots = await readRootWorkspacePaths(normalizedRoot);
  return [...new Set([...workspaceRoots, ...FIRST_PARTY_AUXILIARY_ROOTS])].sort();
}

export function isFirstPartyProductionPath(relativePath = "") {
  return isFirstPartyCodePath(relativePath, { includeTests: false });
}

export function isTestFilePath(relativePath = "") {
  return testFilePattern.test(relativePath);
}

export function isFirstPartyCodePath(relativePath = "", { includeTests = true } = {}) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized) return false;
  if (!includeTests && isTestFilePath(normalized)) return false;
  return !normalized
    .split("/")
    .some(
      (segment) =>
        ignoredDirectorySet.has(segment) && (includeTests ? !testDirectorySet.has(segment) : true),
    );
}

async function collectDirectoryFiles({
  repositoryRoot,
  relativeDirectory,
  extensions,
  output,
  includeTests,
}) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ignoredDirectorySet.has(entry.name) &&
      !(includeTests && testDirectorySet.has(entry.name))
    )
      continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectDirectoryFiles({
        repositoryRoot,
        relativeDirectory: relativePath,
        extensions,
        output,
        includeTests,
      });
      continue;
    }
    if (!entry.isFile() || !isFirstPartyCodePath(relativePath, { includeTests })) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extensions.has(extension)) output.add(path.normalize(relativePath));
  }
}

async function gitIgnoredPaths(repositoryRoot, relativePaths) {
  if (!relativePaths.length) return new Set();
  const child = execFileAsync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  child.child.stdin.end(relativePaths.join("\0"));
  try {
    const { stdout } = await child;
    return new Set(stdout.split("\0").filter(Boolean));
  } catch (error) {
    if (error?.code === GIT_CHECK_IGNORE_NONE_MATCHED) return new Set();
    throw error;
  }
}

async function collectRepositoryRootFiles({ repositoryRoot, extensions, output, includeTests }) {
  for (const entry of await readdir(repositoryRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !isFirstPartyCodePath(entry.name, { includeTests })) continue;
    if (extensions.has(path.extname(entry.name).toLowerCase())) output.add(entry.name);
  }
}

export async function getFirstPartyProductionFiles({
  repositoryRoot,
  extensions = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
} = {}) {
  return getFirstPartyCodeFiles({ repositoryRoot, extensions, includeTests: false });
}

export async function getFirstPartyCodeFiles({
  repositoryRoot,
  extensions = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue"],
  includeTests = true,
} = {}) {
  const normalizedRoot = path.resolve(repositoryRoot || path.resolve(import.meta.dirname, "../.."));
  const sourceRoots = await getFirstPartySourceRoots({ repositoryRoot: normalizedRoot });
  const extensionSet = new Set(extensions.map((extension) => String(extension).toLowerCase()));
  const output = new Set();
  await collectRepositoryRootFiles({
    repositoryRoot: normalizedRoot,
    extensions: extensionSet,
    output,
    includeTests,
  });
  for (const relativeDirectory of sourceRoots) {
    await collectDirectoryFiles({
      repositoryRoot: normalizedRoot,
      relativeDirectory,
      extensions: extensionSet,
      output,
      includeTests,
    });
  }
  const files = [...output].map((file) => file.replaceAll("\\", "/"));
  const ignored = await gitIgnoredPaths(normalizedRoot, files);
  return files.filter((file) => !ignored.has(file)).sort();
}

export async function getFirstPartyFilesUnder(
  directories,
  { repositoryRoot, extensions, includeTests },
) {
  if (!Array.isArray(directories) || !directories.length) {
    throw new TypeError("getFirstPartyFilesUnder requires a non-empty directory list");
  }
  if (typeof includeTests !== "boolean") {
    throw new TypeError("getFirstPartyFilesUnder requires includeTests as a boolean");
  }
  const prefixes = directories.map((directory) => `${directory.replace(/\/+$/, "")}/`);
  const files = await getFirstPartyCodeFiles({ repositoryRoot, extensions, includeTests });
  return files
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => prefixes.some((prefix) => file.startsWith(prefix)));
}
