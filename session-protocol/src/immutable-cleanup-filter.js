/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupCapture,
  requireImmutableCleanupProgress,
  requireImmutableCleanupCandidate,
  immutableStorageError,
} from "./immutable-storage.js";

export const IMMUTABLE_CLEANUP_FILTER = Object.freeze({
  format: "noobot.cleanup-filter/1",
  file: "filter.json",
  maxEntries: QUANTITY_THRESHOLDS.immutableStorage.cleanupFilterMaxEntries,
  entries: PLAN.chunkEntries,
});

export { requireImmutableCleanupFilterBudget } from "./immutable-storage.js";

export function requireImmutableCleanupFilter(state, capture, digest, format) {
  requireImmutableCleanupCapture(capture, capture.id);
  if (
    !isPlainObject(state) ||
    Object.keys(state).length !== 3 ||
    state.format !== IMMUTABLE_CLEANUP_FILTER.format
  )
    throw immutableStorageError("Invalid cleanup filter checkpoint");
  requireImmutableCleanupProgress(state.progress, digest, capture);
  const output = state.output;
  if (
    !isPlainObject(output) ||
    Object.keys(output).length !== 3 ||
    !Number.isSafeInteger(output.candidates) ||
    output.candidates < 0 ||
    output.candidates > state.progress.processed ||
    !Array.isArray(output.pending) ||
    output.pending.length >= PLAN.chunkEntries ||
    output.pending.length > output.candidates
  )
    throw immutableStorageError("Invalid cleanup filter output");
  for (const file of output.pending) requireImmutableCleanupCandidate(file, format);
  const emitted = output.candidates - output.pending.length;
  if (
    (output.firstChunk === null) !== (emitted === 0) ||
    (state.progress.chunk !== null && emitted % PLAN.chunkEntries !== 0) ||
    (state.progress.chunk === null && output.pending.length !== 0)
  )
    throw immutableStorageError("Invalid cleanup filter candidate chain");
  requireImmutableCleanupProgress(
    { plan: digest, chunk: output.firstChunk, offset: 0, processed: 0 },
    digest,
    { firstChunk: output.firstChunk, candidates: emitted },
  );
  return state;
}
