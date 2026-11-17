/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  decodeImmutableCleanupBytes,
  requireImmutableCleanupCapture,
  requireImmutableCleanupChunk,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableCleanupChunkWriter } from "../../src/session/session-artifact-session/immutable-cleanup-chunks.js";
import { ImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-retention.js";
import { advanceImmutableCleanupMarking } from "../../src/session/session-artifact-session/immutable-cleanup-marking.js";
import {
  initializeImmutableCleanupFiltering,
  advanceImmutableCleanupFiltering,
} from "../../src/session/session-artifact-session/immutable-cleanup-filter.js";

export async function* capturedImmutableCandidates(options) {
  const { retainedHeads, objects, retentionDirectory, signal, format, inventory } = options;
  const retention = new ImmutableCleanupRetention(retentionDirectory, { create: true });
  let marking;
  do {
    marking = await advanceImmutableCleanupMarking({ retainedHeads, objects, retention, signal });
  } while (!marking.complete);
  const id = randomUUID();
  const directory = path.join(retentionDirectory, id);
  await mkdir(directory, { recursive: true });
  const chunks = new ImmutableCleanupChunkWriter(directory, format);
  await chunks.initialize();
  const chain = await chunks.write(inventory, signal);
  const capture = requireImmutableCleanupCapture(
    {
      format: PLAN.captureFormat,
      id,
      dryRun: false,
      ready: true,
      ...chain,
      pages: Math.ceil(chain.candidates / PLAN.chunkEntries),
    },
    id,
  );
  await initializeImmutableCleanupFiltering({ directory, capture, format });
  let filtered;
  do {
    filtered = await advanceImmutableCleanupFiltering({
      directory,
      capture,
      head: retainedHeads[0],
      retention,
      signal,
    });
  } while (!filtered.complete);
  options.onRetainedSegments?.(retention.size);
  let reference = filtered.firstChunk;
  const pages = [];
  while (reference !== null) {
    const chunk = requireImmutableCleanupChunk(
      decodeImmutableCleanupBytes(await readFile(path.join(directory, `${reference}.json`))),
      format,
    );
    pages.push(chunk.files);
    reference = chunk.previous;
  }
  for (const files of pages.reverse()) yield* files;
}
