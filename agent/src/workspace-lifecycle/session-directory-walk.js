/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session/session-artifact-files.js";

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";

async function listEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

async function hasSessionManifest(directory) {
  try {
    await access(path.join(directory, SESSION_ARTIFACT_FILE_NAMES.session));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

export async function* walkSessionManifestDirectories(directory) {
  for (const entry of await listEntries(directory)) {
    if (!entry.isDirectory()) continue;
    if (SESSION_ARTIFACT_DIRECTORIES.has(entry.name)) continue;
    if (entry.name.endsWith(MUTATION_LOCK_SUFFIX)) continue;
    const child = path.join(directory, entry.name);
    if (await hasSessionManifest(child)) yield child;
    yield* walkSessionManifestDirectories(child);
  }
}
