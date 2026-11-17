/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { mkdir, opendir } from "node:fs/promises";
import { fsRm as rm, fsOpen as open, fsLstat as lstat } from "../../shared/storage/fs-adapter.js";
import { filePath as path } from "@noobot/path-resolver";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_READER_RETENTION as RETENTION,
  encodeImmutableReaderRetention,
  encodeImmutableCleanupRecord,
  decodeImmutableReaderRetentionBytes,
  immutablePublicationTarget,
  requireImmutableCleanupPlanId,
  requireImmutableRetainedSnapshot,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import {
  contentDigest,
  writeDurableReplacement,
  syncStorageDirectory,
} from "./immutable-object-store.js";
import { withStorageCleanup } from "./immutable-storage-io.js";
import {
  readImmutableCleanupRetentions,
  publishImmutableCleanupRetention,
} from "./immutable-cleanup-preparation.js";

export function acquireImmutableReaderRetention(store, validate) {
  return sessionMutationCoordinator.run(store.lockPath, async () => {
    const head = await store.snapshot();
    await validate(head);
    return publishRetention(store, head);
  });
}

async function publishRetention(store, head) {
  const id = randomUUID();
  const bytes = encodeImmutableReaderRetention(
    { format: RETENTION.format, id, head },
    id,
    store.format,
  );
  const directory = path.join(store.sessionDir, RETENTION.directory);
  const file = path.join(directory, `${id}.json`);
  await mkdir(directory, { recursive: true });
  await syncStorageDirectory(path.dirname(directory));
  await syncStorageDirectory(store.sessionDir);
  try {
    await writeDurableReplacement(file, bytes);
  } catch (error) {
    return withStorageCleanup(
      async () => {
        throw error;
      },
      () => removeRetention(file, directory),
    );
  }
  return {
    head,
    release: () =>
      sessionMutationCoordinator.run(store.lockPath, () => removeRetention(file, directory)),
  };
}

export async function inspectImmutableReaderRetention(store, readerId) {
  const file = await retentionFile(store, readerId, false);
  return inspectRetentionFile(store, readerId, file);
}

async function retentionFile(store, readerId, allowAbsent) {
  requireImmutableCleanupPlanId(readerId);
  const file = path.join(store.sessionDir, RETENTION.directory, `${readerId}.json`);
  let state;
  try {
    state = await lstat(file);
  } catch (error) {
    if (allowAbsent && error.code === "ENOENT") return null;
    throw error;
  }
  if (!state.isFile()) throw immutableStorageError("Invalid reader retention file type");
  return file;
}

async function inspectRetentionFile(store, readerId, file) {
  const bytes = await readFilePrefix(file, RETENTION.recordBytes + 1, open);
  const record = decodeImmutableReaderRetentionBytes(bytes, readerId, store.format);
  requireImmutableRetainedSnapshot(record.head, await store.snapshot());
  return { readerId, head: record.head, recordDigest: contentDigest(bytes) };
}

export async function recoverImmutableReaderRetention(store, options) {
  const { readerId, expectedRecordDigest, signal } = options;
  const file = await retentionFile(store, readerId, true);
  if (file !== null) {
    const inspected = await inspectRetentionFile(store, readerId, file);
    if (inspected.recordDigest !== expectedRecordDigest)
      throw Object.assign(new Error("Reader retention changed since inspection"), {
        code: "SESSION_READER_RETENTION_CHANGED",
      });
  }
  signal?.throwIfAborted();
  const directory = path.join(store.sessionDir, RETENTION.directory);
  await removeRetention(path.join(directory, `${readerId}.json`), directory);
  return { readerId, released: file !== null };
}

async function releaseRetentions(retentions) {
  const errors = [];
  for (const retention of retentions) {
    try {
      await retention.release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Audit retention release failed");
}

export async function captureImmutablePreparationRetention(store, options) {
  return sessionMutationCoordinator.run(store.lockPath, async () => {
    options.signal?.throwIfAborted();
    const head = await store.snapshot();
    const retainedSnapshots = await readImmutableReaderRetentions(store, head, options.signal);
    await publishImmutableCleanupRetention(options.directory, options.id, [
      head,
      ...retainedSnapshots,
    ]);
    return { head, retainedSnapshots };
  });
}

export async function withImmutableAuditRetention(store, signal, run) {
  const retentions = [];
  return withStorageCleanup(
    async () => {
      const captured = await sessionMutationCoordinator.run(store.lockPath, async () => {
        signal?.throwIfAborted();
        const head = await store.snapshot();
        const retainedSnapshots = await readImmutableReaderRetentions(store, head, signal);
        const snapshots = new Map(
          [...retainedSnapshots, head].map((snapshot) => [
            encodeImmutableCleanupRecord(snapshot),
            snapshot,
          ]),
        );
        for (const snapshot of snapshots.values()) {
          signal?.throwIfAborted();
          retentions.push(await publishRetention(store, snapshot));
        }
        return { head, retainedSnapshots };
      });
      signal?.throwIfAborted();
      return run(captured);
    },
    () => releaseRetentions(retentions),
  );
}

async function removeRetention(file, directory) {
  await withStorageCleanup(
    () => rm(file, { force: true }),
    () => syncStorageDirectory(directory),
  );
}

function retentionEntryId(name) {
  if (!name.endsWith(".json")) throw immutableStorageError("Invalid reader retention filename");
  try {
    return requireImmutableCleanupPlanId(name.slice(0, -5));
  } catch (cause) {
    throw immutableStorageError("Invalid reader retention identity", cause);
  }
}

export async function readImmutableReaderRetentions(store, head, signal) {
  const directory = path.join(store.sessionDir, RETENTION.directory);
  const snapshots = new Map();
  for (const snapshot of await readImmutableCleanupRetentions(store, head, signal))
    snapshots.set(encodeImmutableCleanupRecord(snapshot), snapshot);
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [...snapshots.values()];
    throw error;
  }
  for await (const entry of entries) {
    signal?.throwIfAborted();
    if (!entry.isFile()) throw immutableStorageError("Invalid reader retention file type");
    const temporary = immutablePublicationTarget(entry.name);
    if (temporary !== null) {
      retentionEntryId(temporary);
      continue;
    }
    const id = retentionEntryId(entry.name);
    const bytes = await readFilePrefix(
      path.join(directory, entry.name),
      RETENTION.recordBytes + 1,
      open,
    );
    const record = decodeImmutableReaderRetentionBytes(bytes, id, store.format);
    requireImmutableRetainedSnapshot(record.head, head);
    snapshots.set(encodeImmutableCleanupRecord(record.head), record.head);
  }
  return [...snapshots.values()];
}
