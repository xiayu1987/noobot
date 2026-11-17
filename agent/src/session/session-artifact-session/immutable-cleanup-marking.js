/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { setImmediate } from "node:timers/promises";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupMark,
  requireImmutableCleanupMarkingBudget,
  requireImmutableCleanupSessionFormat,
  requireImmutableSessionHead,
  encodeImmutableCleanupRecord,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { requireImmutableRecordLocation } from "@noobot/session-protocol/immutable-record-location";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { contentDigest } from "./immutable-storage-io.js";
import {
  followingLocationPage,
  seekLocationPage,
  descendLocationBranch,
} from "./immutable-location-page-cursor.js";

function markingCursor(retention, heads) {
  if (!Array.isArray(heads) || !heads.length)
    throw new TypeError("Cleanup marking requires explicit retained heads");
  for (const head of heads)
    requireImmutableSessionHead(
      head,
      heads[0].sessionId,
      requireImmutableCleanupSessionFormat(head?.format),
    );
  const headsDigest = contentDigest(encodeImmutableCleanupRecord(heads));
  const mark = retention.mark ?? { headsDigest, rootIndex: 0, path: "" };
  requireImmutableCleanupMark(mark);
  if (
    mark.headsDigest !== headsDigest ||
    mark.rootIndex > heads.length ||
    (mark.rootIndex === heads.length && mark.path !== "")
  )
    throw immutableStorageError("Cleanup marking cursor requires its captured roots");
  return { ...mark };
}

async function retainLocationPage({ retention, objects, node, trail, signal }) {
  const page = await objects.locations.readPage(node.reference, node.path);
  await retention.add(decodeImmutableRecordReference(node.reference).segmentId);
  if (page.kind === "index-branch") return descendLocationBranch(page, node, trail);
  for (const [identity, location] of page.entries) {
    signal?.throwIfAborted();
    requireImmutableRecordLocation(identity, location);
    await retention.add(decodeImmutableRecordReference(location).segmentId);
  }
  return followingLocationPage(trail);
}

export async function advanceImmutableCleanupMarking({
  retainedHeads,
  objects,
  retention,
  maxPages = PLAN.markingPages,
  signal,
}) {
  requireImmutableCleanupMarkingBudget(maxPages);
  signal?.throwIfAborted();
  await retention.load();
  const mark = markingCursor(retention, retainedHeads);
  let scannedPages = 0;
  let seekPageReads = 0;
  while (mark.rootIndex < retainedHeads.length && scannedPages < maxPages) {
    signal?.throwIfAborted();
    const head = retainedHeads[mark.rootIndex];
    if (head.segmentTail !== null) await retention.add(head.segmentTail.segmentId);
    const seek = await seekLocationPage(objects, head, mark, signal);
    seekPageReads += seek.seekPageReads;
    let node = seek.node;
    if (node === null) scannedPages += 1;
    while (node !== null && scannedPages < maxPages) {
      signal?.throwIfAborted();
      node = await retainLocationPage({ retention, objects, node, trail: seek.trail, signal });
      scannedPages += 1;
      await setImmediate();
    }
    mark.path = node?.path ?? "";
    if (node === null) mark.rootIndex += 1;
  }
  signal?.throwIfAborted();
  if (scannedPages !== 0) await retention.checkpoint(mark);
  return {
    complete: mark.rootIndex === retainedHeads.length,
    scannedPages,
    seekPageReads,
    retainedSegments: retention.size,
  };
}
