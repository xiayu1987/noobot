/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "@noobot/shared/file-system";
import { filePath as path } from "@noobot/path-resolver";
import { isSessionRepairTempDirectoryName } from "@noobot/session-repair";
import { isSessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session/session-artifact-files.js";
import { UNSUPPORTED_SESSION_STORAGE } from "@noobot/session-protocol/session-storage-format";
import { PARTITION_JOURNAL_DIRECTORIES } from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MIGRATION_AUTHORITY,
  inspectSessionStorageAuthority,
} from "@noobot/session-protocol/session-reader";
import { readSessionStorageAuthority } from "../session/session-storage-authority.js";

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";
const IMMUTABLE_ARTIFACT_DIRECTORIES = new Set(UNSUPPORTED_SESSION_STORAGE.directories);
const PARTITION_ARTIFACT_DIRECTORIES = new Set(Object.values(PARTITION_JOURNAL_DIRECTORIES));

async function listEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readSessionDirectory(directory) {
  const result = await inspectSessionDirectory(directory);
  if (result.error) throw result.error;
  return result;
}

export async function inspectSessionDirectory(directory) {
  const entries = await listEntries(directory);
  const facts = await readSessionStorageAuthority(directory);
  const inspection = inspectSessionStorageAuthority(facts);
  const children = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !SESSION_ARTIFACT_DIRECTORIES.has(entry.name) &&
      entry.name !== PARTITION_MIGRATION_AUTHORITY.directory &&
      !entry.name.endsWith(PARTITION_MIGRATION_AUTHORITY.scratchSuffix) &&
      !(facts?.immutable && IMMUTABLE_ARTIFACT_DIRECTORIES.has(entry.name)) &&
      !(
        (facts.partition || facts.migration !== undefined) &&
        PARTITION_ARTIFACT_DIRECTORIES.has(entry.name)
      ) &&
      !entry.name.endsWith(MUTATION_LOCK_SUFFIX) &&
      !isSessionDeletionStagingName(entry.name) &&
      !isSessionRepairTempDirectoryName(entry.name),
  );
  return { entries, children, ...inspection };
}

export function ignoreSessionProgress() {}

export async function* discoverSessionDirectories(base, roots) {
  async function* walk(directory) {
    const { authority, format, error, children } = await inspectSessionDirectory(directory);
    if (error || authority === "immutable") {
      yield { sessionDir: directory, authority, format, error };
      return;
    }
    for (const child of children) yield* walk(path.join(directory, child.name));
    if (authority !== null) yield { sessionDir: directory, authority, format, error };
  }
  for (const root of roots) {
    const directory = path.join(base, root);
    const { children } = await readSessionDirectory(directory);
    for (const child of children) yield* walk(path.join(directory, child.name));
  }
}
