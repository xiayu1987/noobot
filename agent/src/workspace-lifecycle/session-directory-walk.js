/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isSessionRepairTempDirectoryName } from "@noobot/session-repair";
import { isSessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session/session-artifact-files.js";
import { IMMUTABLE_SESSION_DIRECTORIES } from "@noobot/session-protocol/immutable-storage";
import { PARTITION_JOURNAL_DIRECTORIES } from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MIGRATION_AUTHORITY,
  resolveSessionStorageAuthority,
} from "@noobot/session-protocol/session-reader";
import { readSessionStorageAuthority } from "../session/session-storage-authority.js";

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";
const IMMUTABLE_ARTIFACT_DIRECTORIES = new Set(Object.values(IMMUTABLE_SESSION_DIRECTORIES));
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
  const entries = await listEntries(directory);
  const facts = entries.length ? await readSessionStorageAuthority(directory) : null;
  const authority = facts === null ? null : resolveSessionStorageAuthority(facts);
  const legacyDocument = authority === "immutable" && facts.document && !facts.immutable;
  const children = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !SESSION_ARTIFACT_DIRECTORIES.has(entry.name) &&
      entry.name !== PARTITION_MIGRATION_AUTHORITY.directory &&
      !entry.name.endsWith(PARTITION_MIGRATION_AUTHORITY.scratchSuffix) &&
      !(facts?.immutable && IMMUTABLE_ARTIFACT_DIRECTORIES.has(entry.name)) &&
      !(authority === "partition" && PARTITION_ARTIFACT_DIRECTORIES.has(entry.name)) &&
      !entry.name.endsWith(MUTATION_LOCK_SUFFIX) &&
      !isSessionDeletionStagingName(entry.name) &&
      !isSessionRepairTempDirectoryName(entry.name),
  );
  return { entries, children, authority, legacyDocument };
}

export function ignoreSessionProgress() {}

export async function* walkSessionManifestDirectories(
  directory,
  { includeImmutable = false } = {},
) {
  async function* walk(current, includeSelf) {
    const { children, authority, legacyDocument } = await readSessionDirectory(current);
    if (includeSelf && authority === "immutable" && (legacyDocument || includeImmutable))
      yield current;
    for (const entry of children) yield* walk(path.join(current, entry.name), true);
  }
  yield* walk(directory, false);
}
