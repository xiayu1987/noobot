/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";
import { isMessageIdentity } from "./identity/message-identity.js";
import { partitionJournalError } from "./partition-journal.js";
import { PARTITION_TOOL_PAIR_RESULTS } from "./partition-collections.js";
import {
  readPartitionMessagePositionVisibility,
  requirePartitionVisibleMessageTurnOwnership,
} from "./partition-session-messages.js";

export const PARTITION_TOOL_PAIRS = Object.freeze({
  pairs: "toolPairs",
  results: PARTITION_TOOL_PAIR_RESULTS,
});

export function partitionToolPairKey(identity) {
  return storageDigest(identity);
}

export function partitionToolPairResultKey(identity, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new TypeError("Invalid tool pair result ordinal");
  return JSON.stringify([partitionToolPairKey(identity), ordinal]);
}

export function requireToolPairMembershipHeader(value, invalid) {
  if (
    typeof value?.identity !== "string" ||
    (value.ownerUid !== "" && !isMessageIdentity(value.ownerUid)) ||
    !Number.isSafeInteger(value.resultCount) ||
    value.resultCount < 0
  )
    throw invalid("Invalid tool pair membership header");
  return { identity: value.identity, ownerUid: value.ownerUid, resultCount: value.resultCount };
}

export function requirePartitionToolPair(value, identity) {
  requireToolPairMembershipHeader(value, (message) =>
    partitionJournalError("SESSION_STORAGE_CORRUPT", message),
  );
  if (value.identity !== identity)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition tool pair");
  return value;
}

async function visibleResultCount(resultCount, resultVisible) {
  if (!resultCount || (await resultVisible(resultCount))) return resultCount;
  let low = 0;
  let high = resultCount;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (await resultVisible(middle)) low = middle;
    else high = middle;
  }
  return low;
}

export function createPartitionToolPairReader({
  read,
  checkMember,
  identity,
  value,
  count,
  sessionId,
}) {
  requirePartitionToolPair(value, identity);
  const visible = async (messageUid, role) => {
    if (!isMessageIdentity(messageUid))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing tool pair member");
    const stored = (await read({ collection: "messages", keys: [messageUid] })).get(messageUid);
    const record = checkMember(stored?.value, messageUid, identity, role);
    const [present] = await readPartitionMessagePositionVisibility(read, sessionId, count, {
      records: [record],
    });
    if (present) await requirePartitionVisibleMessageTurnOwnership(read, [record]);
    return present ? { messageUid, sessionOrdinal: record.sessionOrdinal } : null;
  };
  const readResult = async (ordinal) => {
    const key = partitionToolPairResultKey(identity, ordinal);
    const result = (await read({ collection: PARTITION_TOOL_PAIRS.results, keys: [key] })).get(key);
    return visible(result?.value, "result");
  };
  return {
    async visitResults(visit, signal) {
      let previous = 0;
      let retired = false;
      for (let slot = 1; slot <= value.resultCount; slot += 1) {
        signal?.throwIfAborted();
        const result = await readResult(slot);
        if (result === null) {
          retired = true;
          continue;
        }
        if (retired || result.sessionOrdinal <= previous)
          throw partitionJournalError(
            "SESSION_STORAGE_CORRUPT",
            "Invalid visible tool result order",
          );
        previous = result.sessionOrdinal;
        await visit(result.messageUid);
      }
    },
    async readHeader() {
      const ownerUid =
        value.ownerUid && (await visible(value.ownerUid, "declaration")) ? value.ownerUid : "";
      const resultCount = await visibleResultCount(value.resultCount, readResult);
      return { identity, ownerUid, resultCount };
    },
  };
}

export function readPartitionVisibleToolPair(input) {
  return createPartitionToolPairReader(input).readHeader();
}
