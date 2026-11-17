/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";
import { fsMkdir, fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  IMMUTABLE_SEGMENT,
  decodeImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import {
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  immutableStorageError,
  requireImmutableStoredContent,
} from "@noobot/session-protocol/immutable-storage";
import {
  contentDigest,
  syncStorageDirectory,
  writeDurableReplacement,
} from "./immutable-storage-io.js";

export async function prepareImmutableSegmentRepair(segments, id, records) {
  const file = segments.segmentPath(id);
  let handle;
  try {
    handle = await fsOpen(file, "r");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const original = handle ? await readHandlePrefix(handle, IMMUTABLE_SEGMENT.bytes + 1) : undefined;
  if (original && original.length > IMMUTABLE_SEGMENT.bytes)
    throw immutableStorageError("Cannot repair an oversized immutable segment");
  const length = records.reduce(
    (end, record) => Math.max(end, record.offset + record.length),
    original?.length ?? IMMUTABLE_SEGMENT.magic.length,
  );
  const restored = Buffer.alloc(length);
  original?.copy(restored);
  restored.write(IMMUTABLE_SEGMENT.magic, 0, "utf8");
  for (const record of records) record.bytes.copy(restored, record.offset);
  return { file, original, restored };
}

export async function restoreImmutableSegmentRecords(segments, replacements, signal) {
  const grouped = new Map();
  for (const [reference, bytes] of replacements) {
    signal?.throwIfAborted();
    requireImmutableStoredContent(
      reference,
      { digest: contentDigest(bytes), length: bytes.length },
      IMMUTABLE_SEGMENT_SESSION_FORMAT,
    );
    const record = decodeImmutableRecordReference(reference);
    if (!grouped.has(record.segmentId)) grouped.set(record.segmentId, []);
    grouped.get(record.segmentId).push({ ...record, bytes });
  }

  for (const records of grouped.values()) {
    records.sort((left, right) => left.offset - right.offset || left.length - right.length);
    let end = IMMUTABLE_SEGMENT.magic.length;
    for (const record of records) {
      if (record.offset < end && record.length !== 0)
        throw immutableStorageError("Repair records overlap within their segment");
      end = Math.max(end, record.offset + record.length);
    }
  }
  const repaired = [];
  for (const [id, records] of grouped) {
    signal?.throwIfAborted();
    const { file, original, restored } = await prepareImmutableSegmentRepair(segments, id, records);
    signal?.throwIfAborted();
    if (original?.equals(restored)) {
      await syncStorageDirectory(segments.directory);
    } else {
      await fsMkdir(segments.directory, { recursive: true });
      await writeDurableReplacement(file, restored);
      repaired.push(`${IMMUTABLE_SEGMENT.directory}/${path.basename(file)}`);
    }
  }
  if (grouped.size) await syncStorageDirectory(path.dirname(segments.directory));
  return repaired;
}
