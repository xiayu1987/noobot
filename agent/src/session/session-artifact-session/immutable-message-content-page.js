/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createMessageContentPage,
  requireMessageContentPage,
  messageContentReadError,
} from "@noobot/session-protocol/message-read-budget";
import { requireImmutableMessageContentPart } from "@noobot/session-protocol/immutable-storage-graph";
import { readImmutableMessageMetadata } from "./immutable-message-reader.js";
import { readImmutableValueRange } from "./immutable-value-range.js";

export async function readImmutableMessageContentPage({
  store,
  snapshot,
  messageUid,
  byteOffset,
  maxBytes,
  expectedContentReference,
}) {
  const selection = requireMessageContentPage({
    messageUid,
    byteOffset,
    maxBytes,
    expectedContentReference,
  });
  return store.objects.withSnapshot(snapshot, async () => {
    const metadata = await readImmutableMessageMetadata({ store, snapshot, messageUid });
    if (metadata === null) return null;
    const { parts } = metadata;
    const { reference } = requireImmutableMessageContentPart(parts);
    if (expectedContentReference !== null && expectedContentReference !== reference)
      throw messageContentReadError("version", "Message content changed between pages");
    const { bytes, totalBytes } = await readImmutableValueRange(store.objects, reference, {
      offset: byteOffset,
      length: maxBytes,
    });
    return createMessageContentPage({
      generation: snapshot.generation,
      selection,
      contentReference: reference,
      totalBytes,
      bytes,
    });
  });
}
