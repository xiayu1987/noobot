/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export function readRepositoryText(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

export async function readRepositoryJson(relativePath) {
  return JSON.parse(await readRepositoryText(relativePath));
}

export async function repositoryPathExists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function matchingLineHits(file, source, matches, message) {
  return source
    .split(/\r?\n/)
    .flatMap((text, index) => (matches(text) ? [{ file, line: index + 1, message }] : []));
}

export function importReferences(source) {
  return Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), (match) => ({
    specifier: match[1],
    line: offsetLine(source, match.index),
  }));
}

export function escapesDirectory(file, directory, specifier) {
  if (!specifier.startsWith(".")) return false;
  const target = path.resolve(repositoryRoot, path.dirname(file), specifier);
  const relative = path.relative(path.join(repositoryRoot, directory), target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export function offsetLine(source, offset) {
  return source.slice(0, offset).split("\n").length;
}
