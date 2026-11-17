/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { immutableCheckpointKey } from "./immutable-checkpoint-index.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

function assertCheckpointState(header, turnScopeId, receipts) {
  try {
    assertTurnSummaryCheckpointState({ ...header, receipts }, turnScopeId);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable checkpoint state", cause);
  }
  if (
    !Number.isSafeInteger(header.checkpointRevision) ||
    receipts.some((receipt) => !Number.isSafeInteger(receipt.checkpointRevision))
  )
    throw immutableStorageError("Invalid immutable checkpoint revision");
}

async function readCheckpointHead(store, snapshot, turnScopeId) {
  const header = await store.get(snapshot, "checkpointHeads", turnScopeId);
  if (header !== null) assertCheckpointState(header, turnScopeId, []);
  return header;
}

export async function readImmutableCheckpointState(store, snapshot, turnScopeId) {
  const header = await readCheckpointHead(store, snapshot, turnScopeId);
  if (header === null) return null;
  const limit = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  const page = await readCheckpointPage({
    store,
    snapshot,
    turnScopeId,
    header,
    after: Math.max(0, header.checkpointRevision - limit),
    limit,
  });
  return { ...header, receipts: page.receipts };
}

async function readCheckpointReceipt({ store, snapshot, turnScopeId, checkpointId, header }) {
  const receipt = await store.get(
    snapshot,
    "checkpoints",
    immutableCheckpointKey(turnScopeId, checkpointId),
  );
  if (receipt === null) return null;
  return validateCheckpointReceipt(receipt, header, turnScopeId, checkpointId);
}

function validateCheckpointReceipt(receipt, header, turnScopeId, checkpointId) {
  if (
    !header ||
    header.turnScopeId !== turnScopeId ||
    receipt.checkpointId !== checkpointId ||
    !Number.isSafeInteger(receipt.checkpointRevision) ||
    receipt.checkpointRevision < 1 ||
    receipt.checkpointRevision > header.checkpointRevision
  )
    throw immutableStorageError("Checkpoint receipt index identity mismatch");
  assertCheckpointState(header, turnScopeId, [receipt]);
  return receipt;
}

export async function readImmutableCheckpoint(store, snapshot, turnScopeId, checkpointId) {
  const header = await readCheckpointHead(store, snapshot, turnScopeId);
  const receipt = await readCheckpointReceipt({
    store,
    snapshot,
    turnScopeId,
    checkpointId,
    header,
  });
  if (receipt === null) return null;
  const id = await store.get(
    snapshot,
    "checkpointOrder",
    immutableCheckpointKey(turnScopeId, immutableOrderKey(receipt.checkpointRevision)),
  );
  if (id !== checkpointId)
    throw immutableStorageError("Checkpoint receipt order identity mismatch");
  return receipt;
}

export async function readImmutableCheckpointPage({
  store,
  snapshot,
  turnScopeId,
  after = 0,
  limit = QUANTITY_THRESHOLDS.immutableStorage.receiptPageSize,
}) {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 256
  )
    throw new TypeError("Checkpoint page requires a non-negative cursor and limit 1..256");
  const header = await readCheckpointHead(store, snapshot, turnScopeId);
  if (header === null) return null;
  return readCheckpointPage({ store, snapshot, turnScopeId, header, after, limit });
}

async function readCheckpointPage({ store, snapshot, turnScopeId, header, after, limit }) {
  const end =
    after >= header.checkpointRevision ? after : Math.min(header.checkpointRevision, after + limit);
  const orderKeys = [];
  for (let revision = after + 1; revision <= end; revision += 1)
    orderKeys.push(immutableCheckpointKey(turnScopeId, immutableOrderKey(revision)));
  const order = await store.getMany(snapshot, "checkpointOrder", orderKeys);
  const selected = orderKeys.flatMap((key, slot) => {
    const checkpointId = order.get(key);
    return checkpointId === null ? [] : [{ checkpointId, revision: after + slot + 1 }];
  });
  const values = await store.getMany(
    snapshot,
    "checkpoints",
    selected.map(({ checkpointId }) => immutableCheckpointKey(turnScopeId, checkpointId)),
  );
  const receipts = [];
  for (const { checkpointId, revision } of selected) {
    const receipt = values.get(immutableCheckpointKey(turnScopeId, checkpointId));
    if (receipt === null || receipt.checkpointRevision !== revision)
      throw immutableStorageError("Checkpoint order references an invalid receipt");
    receipts.push(validateCheckpointReceipt(receipt, header, turnScopeId, checkpointId));
  }
  return {
    generation: snapshot.generation,
    receipts,
    cursor: end,
    hasMore: end < header.checkpointRevision,
  };
}
