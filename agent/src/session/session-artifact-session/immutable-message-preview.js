/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  decodeSessionMessagePreview,
  sessionMessagePreviewLimits,
} from "@noobot/session-protocol/message-preview";
import { requireImmutableMessageContentPart } from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { buildMessageSummary } from "../session-summary-builders/message-summary-projection.js";
import { readImmutableMessageMetadata } from "./immutable-message-reader.js";
import { readImmutableValueRange } from "./immutable-value-range.js";

async function readImmutableMessageListSummary(store, snapshot, messageUid) {
  return store.objects.withSnapshot(snapshot, async () => {
    const metadata = await readImmutableMessageMetadata({ store, snapshot, messageUid });
    if (metadata === null) return null;
    const { value: record, parts } = metadata;
    const { reference } = requireImmutableMessageContentPart(parts);
    const range = await readImmutableValueRange(store.objects, reference, {
      offset: 0,
      length: sessionMessagePreviewLimits().jsonBytes,
    });
    let preview;
    try {
      preview = decodeSessionMessagePreview(range.bytes, range.totalBytes);
    } catch (cause) {
      throw immutableStorageError("Invalid list message preview", cause);
    }
    return { ...buildMessageSummary({ ...record.message, content: preview.content }), ...preview };
  });
}

export function immutableListProjectionSource(store, snapshot) {
  return {
    get: (collection, key) => store.get(snapshot, collection, key),
    readMessageSummary: (messageUid) =>
      readImmutableMessageListSummary(store, snapshot, messageUid),
  };
}
