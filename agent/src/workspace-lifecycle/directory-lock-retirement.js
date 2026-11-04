/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat, readdir, rmdir, stat, unlink } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { readDirectoryEntriesIfPresent } from "../shared/storage/dir-entries.js";
import {
  isHeartbeatFresh,
  readConfiguredLockTiming,
} from "../shared/storage/file-mutation-coordinator.js";

function retirementError(code, lockPath) {
  const error = new Error(`directory lock retirement cannot proceed: ${lockPath}`);
  error.code = code;
  error.details = { lockPath };
  return error;
}

async function retireDirectory(lockPath) {
  const entries = await readdir(lockPath);
  if (entries.some((name) => name !== "owner")) {
    throw retirementError("DIRECTORY_LOCK_CONTENT_INVALID", lockPath);
  }
  if (entries.includes("owner")) {
    const ownerPath = path.join(lockPath, "owner");
    if (isHeartbeatFresh(await stat(ownerPath), readConfiguredLockTiming().staleMs)) {
      throw retirementError("DIRECTORY_LOCK_OWNER_ALIVE", lockPath);
    }
    await unlink(ownerPath);
  }
  await rmdir(lockPath);
  return true;
}

async function isDirectoryIfPresent(lockPath) {
  try {
    return (await lstat(lockPath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function retireDirectoryLockIfPresent(lockPath) {
  try {
    if (!(await isDirectoryIfPresent(lockPath))) return false;
    return await retireDirectory(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    if (error?.code === "ENOTDIR" && !(await isDirectoryIfPresent(lockPath))) return false;
    throw error;
  }
}

async function* walkLockDirectories(directory, matches) {
  for (const entry of await readDirectoryEntriesIfPresent(directory)) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (matches(entry.name)) yield child;
    else yield* walkLockDirectories(child, matches);
  }
}

async function retireLocksIn(directory, matches, retired) {
  for await (const lockPath of walkLockDirectories(directory, matches)) {
    if (await retireDirectoryLockIfPresent(lockPath)) retired.push(lockPath);
  }
}

export async function retireWorkspaceDirectoryLocks({ base, scopedSessionRoots }) {
  const retired = [];
  await retireLocksIn(
    path.join(base, WORKSPACE_LAYOUT.SESSION_LIFECYCLE_LOCKS_DIR),
    (name) => name.endsWith(".lock"),
    retired,
  );
  const sessionRoots = new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]);
  for (const root of sessionRoots) {
    await retireLocksIn(path.join(base, root), (name) => name.endsWith(".mutation-lock"), retired);
  }
  await retireLocksIn(
    path.join(base, WORKSPACE_LAYOUT.ATTACH_DIR),
    (name) => name === "attachments.json.lock",
    retired,
  );
  return { retired };
}
