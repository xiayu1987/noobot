/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { opendir } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
  immutablePublicationTarget,
  requireImmutableCleanupSessionFormat,
} from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileId,
} from "@noobot/session-protocol/immutable-segment";

async function yieldCandidateScan(signal) {
  await setImmediate();
  signal?.throwIfAborted();
}

async function* segmentInventory({ sessionDir, signal }) {
  let scanned = 0;
  const directory = path.join(sessionDir, IMMUTABLE_SEGMENT.directory);
  for await (const entry of await opendir(directory)) {
    signal?.throwIfAborted();
    if (++scanned % 64 === 0) await yieldCandidateScan(signal);
    if (!entry.isFile()) continue;
    const target = immutablePublicationTarget(entry.name);
    const id = immutableSegmentFileId(target ?? entry.name);
    if (id !== null) yield `${IMMUTABLE_SEGMENT.directory}/${entry.name}`;
  }
}

export async function* immutableOwnedInventory({ sessionDir, format, signal }) {
  requireImmutableCleanupSessionFormat(format);
  yield* segmentInventory({ sessionDir, signal });

  let scanned = 0;
  for await (const entry of await opendir(sessionDir)) {
    signal?.throwIfAborted();
    if (++scanned % 64 === 0) await yieldCandidateScan(signal);
    if (!entry.isFile()) continue;
    const target = immutablePublicationTarget(entry.name);
    if (target === IMMUTABLE_SESSION_HEAD_FILE || target === IMMUTABLE_SESSION_FORMAT_FILE)
      yield entry.name;
  }
}

export async function* filterUnretainedBatch(retainedSegments, files, signal) {
  const entries = files.map((file) => {
    const name = file.split("/").at(-1);
    return {
      file,
      segmentId: immutablePublicationTarget(name) === null ? immutableSegmentFileId(name) : null,
    };
  });
  const retained = await retainedSegments.hasMany(
    entries.filter(({ segmentId }) => segmentId !== null).map(({ segmentId }) => segmentId),
  );
  for (const { file, segmentId } of entries) {
    signal?.throwIfAborted();
    if (segmentId === null || !retained.get(segmentId)) yield file;
  }
}
