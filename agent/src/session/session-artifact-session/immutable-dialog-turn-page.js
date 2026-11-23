/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireDialogTurnPage } from "@noobot/session-protocol/message-read-budget";
import { immutableValueIndexReferences } from "@noobot/session-protocol/immutable-storage-graph";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";

export async function readImmutableDialogTurnPage({
  store,
  snapshot,
  dialogProcessId,
  after = 0,
  limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
  maxBytes,
}) {
  const budget = requireDialogTurnPage({ dialogProcessId, after, limit, maxBytes });
  const descriptor = await store.get(snapshot, "dialogTurns", dialogProcessId);
  if (descriptor === null) {
    if (await store.get(snapshot, "dialogs", dialogProcessId))
      throw immutableStorageError("Dialog is missing its turn membership");
    return null;
  }
  immutableValueIndexReferences("dialogTurns", dialogProcessId, descriptor, store.requireReference);
  if (after > descriptor.count) throw new TypeError("Dialog cursor exceeds its pinned membership");
  const end = after + Math.min(limit, descriptor.count - after);
  const keys = [];
  for (let position = after + 1; position <= end; position += 1)
    keys.push(immutableOrderKey(position));
  const positions = await store.index.getMany(descriptor.root, keys);
  const references = keys.map((key) => positions.get(key));
  if (references.some((reference) => reference === null))
    throw immutableStorageError("Dialog turn membership has a missing position");
  const turnScopeIds = await store.objects.readValues(references, { budget });
  if (turnScopeIds.some((id) => typeof id !== "string" || !id))
    throw immutableStorageError("Dialog turn membership has an invalid identity");
  const turns = await store.getMany(snapshot, "turns", turnScopeIds);
  for (const turnScopeId of turnScopeIds) {
    const turn = turns.get(turnScopeId);
    if (turn?.turnScopeId !== turnScopeId || turn.dialogProcessId !== dialogProcessId)
      throw immutableStorageError("Dialog turn membership ownership mismatch");
  }
  return {
    generation: snapshot.generation,
    turnScopeIds,
    cursor: end,
    hasMore: end < descriptor.count,
  };
}
