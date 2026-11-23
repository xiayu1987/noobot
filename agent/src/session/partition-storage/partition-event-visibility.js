/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertAuthorityEventScope,
  decodeStoredAuthorityOutboxEvent,
  isAuthorityOutboxDeliveryVisible,
} from "@noobot/event-protocol/outbox";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { readPartitionEventTurnVisibility } from "@noobot/session-protocol/partition-turn-visibility";

function corrupt(message, cause) {
  throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", message), { cause });
}

export function partitionAuthorityEventRecord(value, eventId, scope) {
  let record;
  try {
    record = decodeStoredAuthorityOutboxEvent(value);
    assertAuthorityEventScope(record, scope);
  } catch (cause) {
    corrupt("Invalid partition outbox event", cause);
  }
  if (record.eventId !== eventId) corrupt("Partition outbox event ownership mismatch");
  return record;
}

export function partitionAuthorityEventVisible(event, range, tail, compaction) {
  try {
    return isAuthorityOutboxDeliveryVisible({
      range,
      turnScopeId: event.envelope.identity.turnScopeId,
      ordinal: event.ordinal,
      tail,
      compaction,
    });
  } catch (cause) {
    corrupt("Invalid partition outbox delivery visibility", cause);
  }
}

export function partitionEventTurnVisibility(read, checkMessage) {
  const cache = new Map();
  return async (turnScopeIds) => {
    const missing = [...new Set(turnScopeIds)].filter((key) => !cache.has(key));
    if (missing.length) {
      const visibility = await readPartitionEventTurnVisibility(read, missing, checkMessage);
      for (const [key, visible] of visibility) cache.set(key, visible);
    }
    return cache;
  };
}
