/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupCapture,
  requireImmutableCleanupPreparation,
  requireImmutableCleanupManifest,
  requireImmutableRetainedSnapshot,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { immutableOwnedInventory } from "./immutable-object-garbage.js";
import { captureImmutablePreparationRetention } from "./immutable-reader-retention.js";
import { writeDurableReplacement } from "./immutable-storage-io.js";
import { ImmutableCleanupRetention } from "./immutable-cleanup-retention.js";
import { initializeImmutableCleanupFiltering } from "./immutable-cleanup-filter.js";

export async function captureImmutableCleanupInventory(options) {
  const { store, directory, id, dryRun, signal, chunks, preserve } = options;
  await chunks.initialize();
  const inventory = await chunks.write(
    immutableOwnedInventory({ sessionDir: store.sessionDir, format: store.format, signal }),
    signal,
  );
  const record = requireImmutableCleanupCapture(
    {
      format: PLAN.captureFormat,
      id,
      dryRun,
      ...inventory,
      ready: false,
      pages: Math.ceil(inventory.candidates / PLAN.chunkEntries),
    },
    id,
  );
  await writeDurableReplacement(
    path.join(directory, PLAN.capture),
    encodeImmutableCleanupRecord(record),
  );
  preserve();
  return initializeCapturedInventory(options, record);
}

async function readCaptureRecord(directory, file, allowAbsent = false) {
  let handle;
  try {
    handle = await fsOpen(path.join(directory, file), "r");
  } catch (error) {
    if (allowAbsent && error.code === "ENOENT") return undefined;
    throw error;
  }
  return decodeImmutableCleanupBytes(await readHandlePrefix(handle, PLAN.recordBytes + 1));
}

async function readOwnership({ store, directory, id, signal }, allowAbsent) {
  const record = await readCaptureRecord(directory, PLAN.preparation, allowAbsent);
  if (record === undefined)
    return captureImmutablePreparationRetention(store, { directory, id, signal });
  const ownership = requireImmutableCleanupPreparation(record, id);
  const current = await store.snapshot();
  for (const head of ownership.heads) requireImmutableRetainedSnapshot(head, current);
  return { head: ownership.heads[0], retainedSnapshots: ownership.heads.slice(1) };
}

async function initializeCapturedInventory(options, inventory) {
  const { store, directory, id, signal } = options;
  signal?.throwIfAborted();
  const ownership = await readOwnership(options, true);
  const ready = requireImmutableCleanupCapture({ ...inventory, ready: true }, id);
  await initializeImmutableCleanupFiltering({ directory, capture: ready, format: store.format });
  await new ImmutableCleanupRetention(path.join(directory, PLAN.retentionDirectory), {
    create: true,
  }).load();
  signal?.throwIfAborted();
  await writeDurableReplacement(
    path.join(directory, PLAN.capture),
    encodeImmutableCleanupRecord(ready),
  );
  return { inventory: ready, ...ownership };
}

export async function resumeImmutableCleanupInventory(options) {
  const { store, directory, id, dryRun, signal } = options;
  signal?.throwIfAborted();
  const inventory = requireImmutableCleanupCapture(
    await readCaptureRecord(directory, PLAN.capture),
    id,
  );
  if (inventory.dryRun !== dryRun)
    throw immutableStorageError("Cleanup resumption cannot change the captured dryRun policy");
  if (!inventory.ready) return initializeCapturedInventory(options, inventory);
  const published = await readCaptureRecord(directory, PLAN.manifest, true);
  if (published !== undefined) {
    const plan = requireImmutableCleanupManifest(published, id);
    requireImmutableRetainedSnapshot(plan.head, await store.snapshot());
    if (plan.dryRun !== dryRun)
      throw immutableStorageError("Published cleanup does not match its captured policy");
    return { head: plan.head, published: plan };
  }
  return { inventory, ...(await readOwnership(options, false)) };
}
