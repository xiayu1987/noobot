/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./partition-journal.js";
import { PARTITION_COLLECTION_NAMES } from "./partition-collection-names.js";
export {
  PARTITION_MESSAGE_CONTENT,
  PARTITION_TOOL_PAIR_RESULTS,
  PARTITION_SESSION_ARTIFACT_EVENTS,
  PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
} from "./partition-collection-names.js";

const collections = new Set(PARTITION_COLLECTION_NAMES);

export function requirePartitionCollection(collection) {
  if (!collections.has(collection))
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Unknown partition collection");
  return collection;
}
