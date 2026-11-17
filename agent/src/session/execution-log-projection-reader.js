/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fileIdentityKey } from "@noobot/shared/file-identity";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  executionLogByteBudget,
  executionLogProjectionIdentity,
  decodeExecutionSegmentRecordBytes,
} from "@noobot/session-protocol";

function reusableProjectionWindow(
  window,
  segment,
  { sourceIdentity, sourceRevision, dialogProcessId, offset },
) {
  return (
    window !== null &&
    window.sourceIdentity === sourceIdentity &&
    window.sourceRevision === sourceRevision &&
    window.sequence === segment.sequence &&
    window.file === segment.file &&
    window.sourceBytes <= segment.bytes &&
    window.dialogProcessId === dialogProcessId &&
    window.windowOffset + window.start === offset
  );
}

function projectionWindowState(previous, segment, offset) {
  const capacity = Math.min(
    executionLogByteBudget().batchBytes,
    segment.bytes - (previous?.windowOffset ?? offset),
  );
  const bytes =
    previous && previous.bytes.length >= capacity ? previous.bytes : Buffer.alloc(capacity);
  if (previous && bytes !== previous.bytes) previous.bytes.copy(bytes, 0, 0, previous.count);
  return {
    bytes,
    readPosition: previous?.readPosition ?? offset,
    windowOffset: previous?.windowOffset ?? offset,
    start: previous?.start ?? 0,
    count: previous?.count ?? 0,
  };
}

export function createExecutionProjectionReader() {
  let window = null;
  return async function* readExecutionProjectionBatches({
    handle,
    segment,
    dialogProcessId,
    offset,
    sourceInfo,
  }) {
    for (const field of ["dev", "ino", "birthtimeNs", "size", "mtimeNs", "ctimeNs"])
      if (typeof sourceInfo?.[field] !== "bigint")
        throw new TypeError("Execution projection requires the opened source file identity");
    const sourceIdentity = `${sourceInfo.dev}:${sourceInfo.ino}:${sourceInfo.birthtimeNs}`;
    const sourceRevision = fileIdentityKey(sourceInfo);

    const reusable = reusableProjectionWindow(window, segment, {
      sourceIdentity,
      sourceRevision,
      dialogProcessId,
      offset,
    });
    const previous = reusable ? window : null;
    window = null;
    const state = projectionWindowState(previous, segment, offset);
    const { bytes } = state;
    let { readPosition, windowOffset, start, count } = state;
    while (windowOffset + start < segment.bytes) {
      const records = [];
      let end = bytes.indexOf(10, start);
      while (records.length < EXECUTION_LOG_BATCH_MAX_RECORDS && end >= 0 && end < count) {
        const sourceId = executionLogProjectionIdentity(
          dialogProcessId,
          segment.sequence,
          windowOffset + start,
        );
        const record = decodeExecutionSegmentRecordBytes(
          bytes.subarray(start, end),
          segment.file,
          dialogProcessId,
        );
        records.push({ record, sourceId });
        start = end + 1;
        end = bytes.indexOf(10, start);
      }
      if (records.length) {
        window = {
          bytes,
          readPosition,
          windowOffset,
          start,
          count,
          sequence: segment.sequence,
          file: segment.file,
          sourceIdentity,
          sourceRevision,
          sourceBytes: segment.bytes,
          dialogProcessId,
        };
        yield { records, end: windowOffset + start };
        window = null;
        continue;
      }
      if (readPosition === segment.bytes || count - start === bytes.length)
        throw new Error("Execution projection record exceeds byte budget or is torn");
      bytes.copyWithin(0, start, count);
      count -= start;
      windowOffset += start;
      start = 0;
      const target = Math.min(bytes.length - count, segment.bytes - readPosition);
      const loaded = await fillProjectionWindow(handle, bytes, { count, readPosition, target });
      count += loaded;
      readPosition += loaded;
    }
  };
}

async function fillProjectionWindow(handle, bytes, { count, readPosition, target }) {
  let loaded = 0;
  while (loaded < target) {
    const { bytesRead } = await handle.read(
      bytes,
      count + loaded,
      target - loaded,
      readPosition + loaded,
    );
    if (!bytesRead) throw new Error("Execution projection source is truncated");
    loaded += bytesRead;
  }
  return loaded;
}
