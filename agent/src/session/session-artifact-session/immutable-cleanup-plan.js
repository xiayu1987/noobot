/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { mkdir, unlink, open } from "node:fs/promises";
import { fsLstat as lstat, fsRm as rm } from "../../shared/storage/fs-adapter.js";
import { filePath as path } from "@noobot/path-resolver";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  requireImmutableCleanupHead,
  requireImmutableCleanupManifest,
  requireImmutableCleanupProgress,
  requireImmutableCleanupChunk,
  requireImmutableCleanupCursorChunk,
  requireImmutableCleanupPlanId,
  requireImmutableCleanupSessionFormat,
  requireImmutableSessionHead,
  immutableCleanupPreparationInterrupted,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { advanceImmutableCleanupFiltering } from "./immutable-cleanup-filter.js";
import {
  IMMUTABLE_CLEANUP_FILTER as FILTER,
  requireImmutableCleanupFilterBudget,
} from "@noobot/session-protocol/immutable-cleanup-filter";
import { immutableOfflineBackend } from "./immutable-storage-backends.js";
import { releaseImmutableCleanupRetention } from "./immutable-cleanup-preparation.js";
import {
  captureImmutableCleanupInventory,
  resumeImmutableCleanupInventory,
} from "./immutable-cleanup-capture.js";
import { ImmutableCleanupRetention } from "./immutable-cleanup-retention.js";
import { advanceImmutableCleanupMarking } from "./immutable-cleanup-marking.js";
import {
  contentDigest,
  immutableStorageError,
  writeDurableReplacement,
  syncStorageDirectory,
} from "./immutable-object-store.js";
import { withStorageCleanup } from "./immutable-storage-io.js";

import { ImmutableCleanupChunkWriter } from "./immutable-cleanup-chunks.js";
import { withImmutableCleanupPlanMutation } from "./immutable-cleanup-coordinator.js";
import { withImmutableAuthorityMutation } from "../session-storage-authority.js";

function directoryOf(sessionDir, id) {
  return path.join(sessionDir, PLAN.directory, requireImmutableCleanupPlanId(id));
}

async function readRecord(directory, file) {
  const bytes = await readFilePrefix(path.join(directory, file), PLAN.recordBytes + 1, open);
  return {
    record: decodeImmutableCleanupBytes(bytes),
    digest: contentDigest(bytes),
  };
}

async function requirePlanHead(sessionDir, head) {
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: head.sessionId,
    objectStore: immutableOfflineBackend(head.format),
  });
  const current = await store.snapshot();
  let historyProofLookups = 0;
  await requireImmutableCleanupHead(head, current, (generation) => {
    historyProofLookups += 1;
    return store.readCommitReference(current, generation);
  });
  return historyProofLookups;
}

export function buildImmutableCleanupPlan(options) {
  const id = options.planId ?? randomUUID();
  return withImmutableCleanupPlanMutation(options.sessionDir, id, async () => {
    await withImmutableAuthorityMutation(options.sessionDir, () => options.assertWritable?.());
    const publishSessionState = (run) =>
      withImmutableAuthorityMutation(options.sessionDir, async () => {
        await options.assertPublicationWritable?.();
        return run();
      });
    return buildCleanupPlan(
      {
        ...options,
        publishSessionState,
        publish: (run) =>
          options.publish
            ? options.publish(() => publishSessionState(run))
            : publishSessionState(run),
      },
      id,
    );
  });
}

async function buildCleanupPlan(
  {
    sessionDir,
    sessionId,
    dryRun,
    signal,
    publishSessionState,
    publish,
    objectStore,
    planId,
    maxMarkingPages = PLAN.markingPages,
    maxFilterEntries = FILTER.entries,
  },
  id,
) {
  requireImmutableCleanupFilterBudget(maxFilterEntries);
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId, objectStore });
  requireImmutableCleanupSessionFormat(store.format);
  const directory = directoryOf(sessionDir, id);
  if (planId === undefined) await mkdir(directory, { recursive: true });
  let preserve = false;
  try {
    await syncStorageDirectory(path.dirname(directory));
    await syncStorageDirectory(path.dirname(path.dirname(directory)));
    await syncStorageDirectory(sessionDir);

    const chunks = new ImmutableCleanupChunkWriter(directory, store.format);
    const capture =
      planId === undefined ? captureImmutableCleanupInventory : resumeImmutableCleanupInventory;
    const captured = await capture({
      store,
      directory,
      id,
      dryRun,
      signal,
      chunks,
      publishSessionState,
      preserve: () => {
        preserve = true;
      },
    });
    const { head, retainedSnapshots } = captured;
    await requirePlanHead(sessionDir, head);
    if (captured.published !== undefined) {
      const plan = captured.published;
      await publish(() => releaseImmutableCleanupRetention(directory));
      return {
        planId: id,
        generation: head.generation,
        dryRun,
        candidates: plan.candidates,
        retainedSegments: plan.retainedSegments,
        complete: true,
      };
    }
    const retention = new ImmutableCleanupRetention(path.join(directory, PLAN.retentionDirectory));
    const marking = await advanceImmutableCleanupMarking({
      retainedHeads: [head, ...retainedSnapshots],
      objects: store.objects,
      retention,
      maxPages: maxMarkingPages,
      signal,
    });
    if (!marking.complete)
      return { planId: id, generation: head.generation, dryRun, phase: "marking", ...marking };
    const filtered = await advanceImmutableCleanupFiltering({
      directory,
      capture: captured.inventory,
      head,
      retention,
      maxEntries: maxFilterEntries,
      signal,
    });
    if (!filtered.complete)
      return { planId: id, generation: head.generation, dryRun, phase: "filtering", ...filtered };
    const result = await buildRetainedCleanupPlan({
      sessionDir,
      dryRun,
      signal,
      publish,
      head,
      id,
      directory,
      firstChunk: filtered.firstChunk,
      candidates: filtered.candidates,
      retainedSegments: retention.size,
    });
    await publish(() => releaseImmutableCleanupRetention(directory));
    return { ...result, complete: true };
  } catch (error) {
    if (planId !== undefined) throw error;
    if (preserve) throw immutableCleanupPreparationInterrupted(id, error);
    return withStorageCleanup(
      async () => {
        throw error;
      },
      () => removePlanDirectory(directory),
    );
  }
}

async function buildRetainedCleanupPlan({
  sessionDir,
  dryRun,
  signal,
  publish,
  head,
  id,
  directory,
  firstChunk,
  candidates,
  retainedSegments,
}) {
  const plan = requireImmutableCleanupManifest(
    {
      format: PLAN.format,
      id,
      head,
      dryRun,
      firstChunk,
      candidates,
      retainedSegments,
    },
    id,
  );
  const bytes = encodeImmutableCleanupRecord(plan);
  const progress = { plan: contentDigest(bytes), chunk: firstChunk, offset: 0, processed: 0 };
  await publish(async () => {
    signal?.throwIfAborted();
    await requirePlanHead(sessionDir, head);
    await writeDurableReplacement(
      path.join(directory, PLAN.progress),
      encodeImmutableCleanupRecord(progress),
    );
    await writeDurableReplacement(path.join(directory, PLAN.manifest), bytes);
  });
  return {
    planId: id,
    generation: head.generation,
    candidates,
    retainedSegments,
    dryRun,
  };
}

async function loadPlan(sessionDir, planId) {
  const directory = directoryOf(sessionDir, planId);
  const { record, digest } = await readRecord(directory, PLAN.manifest);
  return { directory, plan: requireImmutableCleanupManifest(record, planId), digest };
}

async function removeCandidate(sessionDir, file, dryRun, changed) {
  const absolute = path.join(sessionDir, file);
  let state;
  try {
    state = await lstat(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!dryRun) changed.add(path.dirname(absolute));
    return null;
  }
  if (!state.isFile()) throw immutableStorageError("Cleanup candidate changed its file type");
  if (!dryRun) {
    await unlink(absolute);
    changed.add(path.dirname(absolute));
  }
  return absolute;
}

async function readChunk(directory, reference, format) {
  const { record, digest } = await readRecord(directory, `${reference}.json`);
  if (digest !== reference) throw immutableStorageError("Cleanup chunk identity mismatch");
  return requireImmutableCleanupChunk(record, format);
}

function hasBudget(batch) {
  return (
    batch.processedCandidates < batch.maxCandidates && batch.removed.length < batch.maxRemovals
  );
}

async function consumeChunk(batch, chunk) {
  if (batch.offset >= chunk.files.length)
    throw immutableStorageError("Invalid cleanup chunk offset");
  while (batch.offset < chunk.files.length && hasBudget(batch)) {
    batch.signal?.throwIfAborted();
    const file = await removeCandidate(
      batch.sessionDir,
      chunk.files[batch.offset],
      batch.dryRun,
      batch.changed,
    );
    if (file !== null) batch.removed.push(file);
    batch.offset += 1;
    batch.processedCandidates += 1;
  }
  if (batch.offset === chunk.files.length) {
    batch.chunkReference = chunk.previous;
    batch.offset = 0;
  }
}

async function consumeBatch(batch, directory, plan, progress) {
  while (batch.chunkReference !== null && hasBudget(batch)) {
    batch.signal?.throwIfAborted();
    const chunk = requireImmutableCleanupCursorChunk(
      await readChunk(directory, batch.chunkReference, plan.head.format),
      { offset: batch.offset, processed: progress.processed + batch.processedCandidates },
      plan,
    );
    await consumeChunk(batch, chunk);
  }
}

async function syncChangedDirectories(directories) {
  const errors = [];
  for (const directory of directories) {
    try {
      await syncStorageDirectory(directory);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Cleanup directory synchronization failed");
}

export async function applyImmutableCleanupPlan({
  sessionDir,
  sessionId,
  planId,
  maxRemovals,
  maxCandidates,
  signal,
}) {
  const { directory, plan, digest } = await loadPlan(sessionDir, planId);
  signal?.throwIfAborted();
  requireImmutableSessionHead(plan.head, sessionId, plan.head.format);
  const historyProofLookups = await requirePlanHead(sessionDir, plan.head);
  const progress = requireImmutableCleanupProgress(
    (await readRecord(directory, PLAN.progress)).record,
    digest,
    plan,
  );
  const batch = {
    sessionDir,
    maxRemovals,
    maxCandidates,
    signal,
    dryRun: plan.dryRun,
    chunkReference: progress.chunk,
    offset: progress.offset,
    processedCandidates: 0,
    removed: [],
    changed: new Set(),
  };
  await withStorageCleanup(
    () => consumeBatch(batch, directory, plan, progress),
    () => syncChangedDirectories(batch.changed),
  );
  signal?.throwIfAborted();
  const next = requireImmutableCleanupProgress(
    {
      plan: digest,
      chunk: batch.chunkReference,
      offset: batch.offset,
      processed: progress.processed + batch.processedCandidates,
    },
    digest,
    plan,
  );
  await writeDurableReplacement(
    path.join(directory, PLAN.progress),
    encodeImmutableCleanupRecord(next),
  );
  return {
    ok: true,
    sessionDir,
    planId,
    generation: plan.head.generation,
    dryRun: plan.dryRun,
    removed: batch.removed,
    processedCandidates: batch.processedCandidates,
    processed: next.processed,
    candidates: plan.candidates,
    retainedSegments: plan.retainedSegments,
    complete: batch.chunkReference === null,
    limitReached: batch.chunkReference !== null,
    historyProofLookups,
  };
}

async function removePlanDirectory(directory) {
  await withStorageCleanup(
    () => rm(directory, { recursive: true, force: true }),
    () => syncStorageDirectory(path.dirname(directory)),
  );
}

export async function discardImmutableCleanupPlan({ sessionDir, sessionId, planId }) {
  const directory = directoryOf(sessionDir, planId);
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  requireImmutableCleanupSessionFormat(store.format);
  await removePlanDirectory(directory);
  return { planId, discarded: true };
}
