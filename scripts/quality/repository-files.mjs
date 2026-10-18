/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/gm;

export function readRepositoryText(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function gitListedFiles(root, args) {
  return execFileSync("git", ["ls-files", "-z", ...args], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

export function listRepositoryFiles(root, pattern) {
  const deleted = new Set(gitListedFiles(root, ["--deleted"]));
  return gitListedFiles(root, ["--cached", "--others", "--exclude-standard"]).filter(
    (file) => pattern.test(file) && !deleted.has(file),
  );
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
  return Array.from(source.matchAll(IMPORT_SPECIFIER_PATTERN), (match) => ({
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
