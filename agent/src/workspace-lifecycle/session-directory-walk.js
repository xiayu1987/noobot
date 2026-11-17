/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { isSessionRepairTempDirectoryName } from "@noobot/session-repair";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session/session-artifact-files.js";
import {
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
  IMMUTABLE_SESSION_DIRECTORIES,
} from "@noobot/session-protocol/immutable-storage";

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";
const IMMUTABLE_ARTIFACT_DIRECTORIES = new Set(Object.values(IMMUTABLE_SESSION_DIRECTORIES));

async function listEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

export async function readSessionDirectory(directory) {
  const entries = await listEntries(directory);
  const names = new Set(entries.map((entry) => entry.name));
  const immutable =
    names.has(IMMUTABLE_SESSION_FORMAT_FILE) || names.has(IMMUTABLE_SESSION_HEAD_FILE);
  const children = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !SESSION_ARTIFACT_DIRECTORIES.has(entry.name) &&
      !(immutable && IMMUTABLE_ARTIFACT_DIRECTORIES.has(entry.name)) &&
      !entry.name.endsWith(MUTATION_LOCK_SUFFIX) &&
      !isSessionRepairTempDirectoryName(entry.name),
  );
  return { entries, children, immutable, manifest: names.has(SESSION_ARTIFACT_FILE_NAMES.session) };
}

export function ignoreSessionProgress() {}

export async function* walkSessionManifestDirectories(
  directory,
  { includeImmutable = false } = {},
) {
  async function* walk(current, includeSelf) {
    const { children, immutable, manifest } = await readSessionDirectory(current);
    if (includeSelf && (immutable ? includeImmutable : manifest)) yield current;
    for (const entry of children) yield* walk(path.join(current, entry.name), true);
  }
  yield* walk(directory, false);
}
