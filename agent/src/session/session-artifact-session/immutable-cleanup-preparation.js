/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { opendir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupPlanId,
  requireImmutableCleanupPreparation,
  requireImmutableRetainedSnapshot,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { fsOpen, fsRm } from "../../shared/storage/fs-adapter.js";
import {
  writeDurableReplacement,
  syncStorageDirectory,
  withStorageCleanup,
} from "./immutable-storage-io.js";

export async function publishImmutableCleanupRetention(directory, id, heads) {
  const unique = new Map(heads.map((head) => [encodeImmutableCleanupRecord(head), head]));
  const record = requireImmutableCleanupPreparation(
    { format: PLAN.preparationFormat, id, heads: [...unique.values()] },
    id,
  );
  await writeDurableReplacement(
    path.join(directory, PLAN.preparation),
    encodeImmutableCleanupRecord(record),
  );
}

export async function releaseImmutableCleanupRetention(directory) {
  await withStorageCleanup(
    () => fsRm(path.join(directory, PLAN.preparation), { force: true }),
    () => syncStorageDirectory(directory),
  );
}

async function readPublishedCleanupPreparation(directory, id) {
  let handle;
  try {
    handle = await fsOpen(path.join(directory, id, PLAN.preparation), "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const bytes = await readHandlePrefix(handle, PLAN.recordBytes + 1);
  return requireImmutableCleanupPreparation(decodeImmutableCleanupBytes(bytes), id);
}

export async function readImmutableCleanupRetentions(store, head, signal) {
  const directory = path.join(store.sessionDir, PLAN.directory);
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const snapshots = new Map();
  for await (const entry of entries) {
    signal?.throwIfAborted();
    if (!entry.isDirectory()) throw immutableStorageError("Invalid cleanup plan directory entry");
    const id = requireImmutableCleanupPlanId(entry.name);
    const record = await readPublishedCleanupPreparation(directory, id);
    if (record === null) continue;
    for (const snapshot of record.heads) {
      requireImmutableRetainedSnapshot(snapshot, head);
      snapshots.set(encodeImmutableCleanupRecord(snapshot), snapshot);
    }
  }
  return [...snapshots.values()];
}
