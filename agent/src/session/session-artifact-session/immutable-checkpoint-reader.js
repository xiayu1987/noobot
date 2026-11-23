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
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  createSummaryCheckpointPage,
  requireSummaryCheckpointPage,
} from "@noobot/session-protocol/summary-checkpoint-page";

function assertCheckpointState(header, turnScopeId, receipts) {
  try {
    assertTurnSummaryCheckpointState({ ...header, receipts }, turnScopeId);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable checkpoint state", cause);
  }
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
    revision: header.checkpointRevision,
    limit,
  });
  return { ...header, receipts: page.receipts.reverse() };
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
  if (!header || receipt.checkpointId !== checkpointId)
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

export async function readImmutableCheckpointPage({ store, snapshot, ...options }) {
  const scope = {
    sessionId: snapshot.sessionId,
    snapshotId: JSON.stringify(snapshot.commit),
    generation: snapshot.generation,
    limits: {
      pageRecords: QUANTITY_THRESHOLDS.immutableStorage.messagePageSize,
      pageBytes: LENGTH_THRESHOLDS.sessionStorage.messageReadBytes,
    },
  };
  const requestedRevision = requireSummaryCheckpointPage(scope, options);
  const { turnScopeId, limit } = options;
  const header = await readCheckpointHead(store, snapshot, turnScopeId);
  if (
    requestedRevision !== null &&
    (header === null || requestedRevision > header.checkpointRevision)
  )
    throw new TypeError("Checkpoint cursor exceeds revision tail");
  if (header === null) return null;
  const { receipts, nextRevision } = await readCheckpointPage({
    store,
    snapshot,
    turnScopeId,
    header,
    revision: requestedRevision ?? header.checkpointRevision,
    limit,
  });
  return createSummaryCheckpointPage(scope, options, receipts, nextRevision);
}

async function readCheckpointPage({ store, snapshot, turnScopeId, header, revision, limit }) {
  const end = Math.max(0, revision - limit);
  const orderKeys = [];
  for (let current = revision; current > end; current -= 1)
    orderKeys.push(immutableCheckpointKey(turnScopeId, immutableOrderKey(current)));
  const order = await store.getMany(snapshot, "checkpointOrder", orderKeys);
  const selected = orderKeys.flatMap((key, slot) => {
    const checkpointId = order.get(key);
    return checkpointId === null ? [] : [{ checkpointId, revision: revision - slot }];
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
  return { receipts, nextRevision: end === 0 ? null : end };
}
