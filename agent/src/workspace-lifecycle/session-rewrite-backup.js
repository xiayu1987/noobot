/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function sizeOrNull(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function isFileUnchanged(originalPath, stagedPath) {
  const [originalSize, stagedSize] = await Promise.all([
    sizeOrNull(originalPath),
    sizeOrNull(stagedPath),
  ]);
  if (originalSize === null || stagedSize === null || originalSize !== stagedSize) return false;
  const [original, staged] = await Promise.all([readFile(originalPath), readFile(stagedPath)]);
  return original.equals(staged);
}

export async function backupRewrittenFiles({ base, backupBase, sessionDir, stagingDir }) {
  const relativeFiles = new Set([
    ...(await listFiles(sessionDir)),
    ...(await listFiles(stagingDir)),
  ]);
  const files = [];
  for (const relativeFile of [...relativeFiles].sort()) {
    const originalPath = path.join(sessionDir, relativeFile);
    const stagedPath = path.join(stagingDir, relativeFile);
    if (await isFileUnchanged(originalPath, stagedPath)) continue;
    const original = (await sizeOrNull(originalPath)) !== null;
    const staged = (await sizeOrNull(stagedPath)) !== null;
    const relativePath = path.relative(base, originalPath);
    if (original) {
      const backupPath = path.join(backupBase, relativePath);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(originalPath, backupPath);
    }
    files.push({ path: relativePath, created: !original, removed: !staged });
  }
  return files;
}
