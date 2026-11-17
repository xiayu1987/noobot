/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { setImmediate } from "node:timers/promises";
import {
  IMMUTABLE_COMPACTION_DISCOVERY as DISCOVERY,
  IMMUTABLE_COMPACTION_BUDGET as BUDGET,
  requireImmutableCompactionPageRequest,
  requireImmutableCompactionCursor,
  requireImmutableRecordLocation,
} from "@noobot/session-protocol/immutable-record-location";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import {
  followingLocationPage,
  seekLocationPage,
  descendLocationBranch,
} from "./immutable-location-page-cursor.js";

function collectCompactionRecord(state, identity, sourceLocation, snapshot) {
  const physical = decodeImmutableRecordReference(sourceLocation);
  if (physical.segmentId === snapshot.segmentTail.segmentId) return true;
  if (state.sourceBytes + physical.length > BUDGET.bytes) return false;
  state.records.push({ identity, sourceLocation });
  state.sourceBytes += physical.length;
  return true;
}

function scanCompactionLeaf({ page, node, state, snapshot, maxRecords, signal }) {
  if (node.offset >= page.entries.length)
    throw immutableStorageError("Compaction leaf cursor offset exceeds its entries");
  while (node.offset < page.entries.length && state.scannedRecords < maxRecords) {
    signal?.throwIfAborted();
    const [identity, sourceLocation] = page.entries[node.offset];
    requireImmutableRecordLocation(identity, sourceLocation);
    if (!collectCompactionRecord(state, identity, sourceLocation, snapshot)) return false;
    state.scannedRecords += 1;
    node.offset += 1;
  }
  return true;
}

function compactionCursor(snapshot, node) {
  if (node === null) return null;
  return requireImmutableCompactionCursor(
    {
      format: DISCOVERY.format,
      sessionId: snapshot.sessionId,
      generation: snapshot.generation,
      locationRoot: snapshot.locationRoot,
      path: node.path,
      offset: node.offset,
    },
    snapshot,
  );
}

function advanceCompactionLeaf(options) {
  const { page, node, trail } = options;
  const byteLimitReached = !scanCompactionLeaf(options);
  return {
    byteLimitReached,
    node: node.offset === page.entries.length ? followingLocationPage(trail) : node,
  };
}

export async function readImmutableCompactionPage(store, snapshot, options = {}) {
  requireImmutableCompactionPageRequest(options, snapshot);
  const {
    cursor: requestedCursor = null,
    maxPages = DISCOVERY.pages,
    maxRecords = BUDGET.records,
    signal,
  } = options;
  const cursor = requestedCursor === null ? null : { ...requestedCursor };
  signal?.throwIfAborted();
  const seek = await seekLocationPage(store.objects, snapshot, cursor, signal);
  let node = seek.node;
  const { trail, seekPageReads } = seek;
  const state = { records: [], scannedRecords: 0, sourceBytes: 0 };
  let scannedPages = 0;
  let byteLimitReached = false;
  while (node !== null && scannedPages < maxPages && state.scannedRecords < maxRecords) {
    signal?.throwIfAborted();
    const page = await store.objects.locations.readPage(node.reference, node.path);
    scannedPages += 1;
    if (page.kind === "index-branch") {
      node = descendLocationBranch(page, node, trail);
    } else {
      ({ node, byteLimitReached } = advanceCompactionLeaf({
        page,
        node,
        state,
        snapshot,
        maxRecords,
        signal,
        trail,
      }));
    }

    await setImmediate();
    signal?.throwIfAborted();
    if (byteLimitReached) break;
  }
  const nextCursor = compactionCursor(snapshot, node);
  return {
    records: state.records,
    cursor: nextCursor,
    complete: nextCursor === null,
    scannedPages,
    seekPageReads,
    scannedRecords: state.scannedRecords,
    sourceBytes: state.sourceBytes,
  };
}
