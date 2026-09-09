/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const BASE_IGNORE_DIRECTORIES = ["node_modules", ".git", "dist", "build", "coverage"];

export const MISSING_DIRECTORY_POLICY = {
  SKIP_MISSING: "skip-missing",
  SKIP_UNREADABLE: "skip-unreadable",
  REQUIRE: "require",
};

export function ignorePathParts(directories = []) {
  const merged = [...BASE_IGNORE_DIRECTORIES, ...directories];
  return [...new Set(merged)].map((directory) => `${path.sep}${directory}${path.sep}`);
}

function readEntries(directory, missingDirectory) {
  if (missingDirectory === MISSING_DIRECTORY_POLICY.SKIP_UNREADABLE) {
    try {
      return readdirSync(directory, { withFileTypes: true });
    } catch {
      return null;
    }
  }
  if (missingDirectory === MISSING_DIRECTORY_POLICY.SKIP_MISSING && !existsSync(directory)) {
    return null;
  }
  return readdirSync(directory, { withFileTypes: true });
}

export function walkSourceFiles(directory, options = {}) {
  const {
    extensions,
    ignoredPathParts = [],
    ignoredBasenames = null,
    missingDirectory = MISSING_DIRECTORY_POLICY.SKIP_MISSING,
  } = options;
  if (!(extensions instanceof Set)) {
    throw new TypeError("walkSourceFiles requires options.extensions as a Set");
  }
  const collected = [];
  const visit = (current) => {
    const entries = readEntries(current, missingDirectory);
    if (entries === null) return;
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (ignoredPathParts.some((part) => full.includes(part))) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignoredBasenames?.has(entry.name)) continue;
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
      collected.push(full);
    }
  };
  visit(directory);
  return collected;
}

export function collectSourceFiles(directories, options = {}) {
  const seen = new Set();
  for (const directory of directories) {
    for (const file of walkSourceFiles(directory, options)) seen.add(file);
  }
  return [...seen];
}

export function createRelativeSourceCollector(options = {}) {
  const { root, extensions, ignoredDirectories = null } = options;
  if (typeof root !== "string" || !root) {
    throw new TypeError("createRelativeSourceCollector requires options.root as a non-empty string");
  }
  if (!(extensions instanceof Set)) {
    throw new TypeError("createRelativeSourceCollector requires options.extensions as a Set");
  }
  const ignored = ignoredDirectories instanceof Set ? ignoredDirectories : null;
  const collect = async (relativeDirectory) => {
    const collected = [];
    for (const entry of await readdir(path.join(root, relativeDirectory), { withFileTypes: true })) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (ignored?.has(entry.name)) continue;
        collected.push(...(await collect(relative)));
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions.has(path.extname(entry.name).toLowerCase())) collected.push(relative);
    }
    return collected;
  };
  return collect;
}

export async function collectRelativeSourceFiles(directories, options = {}) {
  const collect = createRelativeSourceCollector(options);
  const groups = await Promise.all(directories.map((directory) => collect(directory)));
  return [...new Set(groups.flat())];
}
