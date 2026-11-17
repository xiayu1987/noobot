/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableMessage, readImmutableTurnAnchor } from "./immutable-message-reader.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

function assertRangeInput({ turnScopeId, after, limit }) {
  if (typeof turnScopeId !== "string" || !turnScopeId || turnScopeId.trim() !== turnScopeId)
    throw new TypeError("Message range requires a canonical turn scope ID");
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > QUANTITY_THRESHOLDS.immutableStorage.messagePageSize
  )
    throw new TypeError(
      `Message range requires a non-negative cursor and limit 1..${QUANTITY_THRESHOLDS.immutableStorage.messagePageSize}`,
    );
}

async function readRangeAnchor({ store, snapshot, turnScopeId, after }) {
  const first = await readImmutableTurnAnchor({ store, snapshot, turnScopeId });
  if (first === null) return null;
  if (!first || !Number.isSafeInteger(first.ordinal) || first.ordinal < 1)
    throw immutableStorageError("Message range anchor has no committed position");
  const facts = await store.get(snapshot, "metadata", "facts");
  if (
    !facts ||
    !Number.isSafeInteger(facts.messageSequence) ||
    facts.messageSequence < first.ordinal ||
    facts.messageCount !== facts.messageSequence
  )
    throw immutableStorageError("Invalid message range sequence or count");
  if (after !== 0 && (after < first.ordinal - 1 || after > facts.messageSequence))
    throw new TypeError("Message range cursor is outside the anchored suffix");
  return { first, facts };
}

export async function readImmutableMessageTailPage({
  store,
  snapshot,
  turnScopeId,
  after = 0,
  limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
}) {
  assertRangeInput({ turnScopeId, after, limit });
  const anchor = await readRangeAnchor({ store, snapshot, turnScopeId, after });
  if (anchor === null) return null;
  const { first, facts } = anchor;
  const start = after === 0 ? first.ordinal - 1 : after;
  const end = start + Math.min(limit, facts.messageSequence - start);
  const records = [];
  for (let ordinal = start + 1; ordinal <= end; ordinal += 1) {
    const messageUid = await store.get(snapshot, "messageOrder", immutableOrderKey(ordinal));
    if (typeof messageUid !== "string" || !messageUid)
      throw immutableStorageError("Message range has a missing committed position");
    const record = await readImmutableMessage(store, snapshot, messageUid);
    if (!record || record.ordinal !== ordinal)
      throw immutableStorageError("Message range position references an invalid message");
    if (ordinal === first.ordinal && messageUid !== first.message.messageUid)
      throw immutableStorageError("Message range anchor disagrees with global order");
    records.push(record);
  }
  return {
    generation: snapshot.generation,
    anchorIndex: first.ordinal - 1,
    deletedCount: facts.messageSequence - first.ordinal + 1,
    records,
    cursor: end,
    hasMore: end < facts.messageSequence,
  };
}
