/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";

const REASON_SUFFIX = ".reason.json";

function describeError(error) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
    ...(error?.details ? { details: error.details } : {}),
  };
}

export async function quarantineMigrationUnit({ base, kind, relativePath, error, move = false }) {
  const quarantineRoot = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR, kind);
  const target = path.join(quarantineRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  if (move) await rename(path.join(base, relativePath), target);
  const reasonPath = `${target}${REASON_SUFFIX}`;
  const reason = {
    kind,
    path: relativePath,
    moved: move,
    quarantinedAt: new Date().toISOString(),
    error: describeError(error),
  };
  await writeFile(reasonPath, `${JSON.stringify(reason, null, 2)}\n`);
  return {
    path: relativePath,
    quarantinePath: path.relative(base, move ? target : reasonPath),
    error: reason.error,
  };
}

async function listReasonFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(REASON_SUFFIX))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

export async function releaseQuarantinedUnits({ base, kind }) {
  const quarantineRoot = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR, kind);
  const released = [];
  for (const reasonPath of await listReasonFiles(quarantineRoot)) {
    const reason = JSON.parse(await readFile(reasonPath, "utf8"));
    if (reason.moved) {
      const original = path.join(base, reason.path);
      await mkdir(path.dirname(original), { recursive: true });
      await rename(reasonPath.slice(0, -REASON_SUFFIX.length), original);
    }
    await rm(reasonPath);
    released.push(reason.path);
  }
  return released;
}

export async function listQuarantinedUnits({ base }) {
  const quarantineRoot = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR);
  const units = [];
  for (const reasonPath of await listReasonFiles(quarantineRoot)) {
    const reason = JSON.parse(await readFile(reasonPath, "utf8"));
    const heldPath = reason.moved ? reasonPath.slice(0, -REASON_SUFFIX.length) : reasonPath;
    units.push({ ...reason, quarantinePath: path.relative(base, heldPath) });
  }
  return units;
}

export async function listWorkspaceBackups({ base }) {
  try {
    const entries = await readdir(path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
