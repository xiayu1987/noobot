/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupChunk,
  requireImmutableCleanupCursorChunk,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_CLEANUP_FILTER as FILTER,
  requireImmutableCleanupFilter,
  requireImmutableCleanupFilterBudget,
} from "@noobot/session-protocol/immutable-cleanup-filter";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { contentDigest, writeDurableReplacement } from "./immutable-storage-io.js";
import { ImmutableCleanupChunkWriter } from "./immutable-cleanup-chunks.js";
import { filterUnretainedBatch } from "./immutable-object-garbage.js";

export async function initializeImmutableCleanupFiltering({ directory, capture, format }) {
  const digest = contentDigest(encodeImmutableCleanupRecord(capture));
  const state = requireImmutableCleanupFilter(
    {
      format: FILTER.format,
      progress: { plan: digest, chunk: capture.firstChunk, offset: 0, processed: 0 },
      output: { firstChunk: null, candidates: 0, pending: [] },
    },
    capture,
    digest,
    format,
  );
  await writeDurableReplacement(
    path.join(directory, FILTER.file),
    encodeImmutableCleanupRecord(state),
  );
}

async function readChunk(directory, reference, format) {
  const bytes = await readFilePrefix(
    path.join(directory, `${reference}.json`),
    PLAN.recordBytes + 1,
    fsOpen,
  );
  if (contentDigest(bytes) !== reference)
    throw immutableStorageError("Cleanup inventory chunk identity mismatch");
  return requireImmutableCleanupChunk(decodeImmutableCleanupBytes(bytes), format);
}

async function emitPending(chunks, output, signal) {
  const chain = await chunks.write(output.pending, signal, {
    firstChunk: output.firstChunk,
    candidates: output.candidates - output.pending.length,
  });
  output.firstChunk = chain.firstChunk;
  output.pending = [];
}

export async function advanceImmutableCleanupFiltering({
  directory,
  capture,
  head,
  retention,
  maxEntries = FILTER.entries,
  signal,
}) {
  requireImmutableCleanupFilterBudget(maxEntries);
  signal?.throwIfAborted();
  const digest = contentDigest(encodeImmutableCleanupRecord(capture));
  const bytes = await readFilePrefix(
    path.join(directory, FILTER.file),
    PLAN.recordBytes + 1,
    fsOpen,
  );
  const state = requireImmutableCleanupFilter(
    decodeImmutableCleanupBytes(bytes),
    capture,
    digest,
    head.format,
  );
  const chunks = new ImmutableCleanupChunkWriter(directory, head.format);
  let processedEntries = 0;
  while (state.progress.chunk !== null && processedEntries < maxEntries) {
    signal?.throwIfAborted();
    const chunk = requireImmutableCleanupCursorChunk(
      await readChunk(directory, state.progress.chunk, head.format),
      state.progress,
      { ...capture, head },
    );
    const entries = chunk.files.slice(
      state.progress.offset,
      state.progress.offset + maxEntries - processedEntries,
    );
    for await (const candidate of filterUnretainedBatch(retention, entries, signal)) {
      state.output.pending.push(candidate);
      state.output.candidates += 1;
      if (state.output.pending.length === PLAN.chunkEntries)
        await emitPending(chunks, state.output, signal);
    }
    state.progress.offset += entries.length;
    state.progress.processed += entries.length;
    processedEntries += entries.length;
    if (state.progress.offset === chunk.files.length) {
      state.progress.chunk = chunk.previous;
      state.progress.offset = 0;
    }
  }
  if (state.progress.chunk === null && state.output.pending.length)
    await emitPending(chunks, state.output, signal);
  signal?.throwIfAborted();
  requireImmutableCleanupFilter(state, capture, digest, head.format);
  if (processedEntries)
    await writeDurableReplacement(
      path.join(directory, FILTER.file),
      encodeImmutableCleanupRecord(state),
    );
  return {
    complete: state.progress.chunk === null,
    processedEntries,
    processed: state.progress.processed,
    firstChunk: state.output.firstChunk,
    candidates: state.output.candidates,
  };
}
