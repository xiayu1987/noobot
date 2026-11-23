/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  RUNTIME_EVENTS_DIR,
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_SCOPES,
  listJsonLineFilesNewestFirst,
  resolveRuntimeEventFileName,
} from "@noobot/runtime-events";

const SYSTEM_EVENT_FILE = resolveRuntimeEventFileName({
  scope: RUNTIME_EVENT_SCOPES.SESSION,
  category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
});

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export async function* legacyActivityEvidenceFiles(sessionDir) {
  const directory = path.join(sessionDir, RUNTIME_EVENTS_DIR);
  const stat = await statIfPresent(directory);
  if (stat === null) return;
  if (!stat.isDirectory()) throw new TypeError(`Invalid legacy evidence directory: ${directory}`);
  const active = path.join(directory, SYSTEM_EVENT_FILE);
  for (const file of await listJsonLineFilesNewestFirst(active)) {
    const entry = file === active ? await statIfPresent(file) : await lstat(file);
    if (entry === null) continue;
    if (!entry.isFile()) throw new TypeError(`Invalid legacy evidence file: ${file}`);
    yield file;
  }
}
