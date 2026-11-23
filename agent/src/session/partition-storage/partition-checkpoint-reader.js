/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { isCanonicalText } from "@noobot/shared/value";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  partitionCheckpointOrderKey,
  requirePartitionCheckpointOrder,
  requirePartitionCheckpointTail,
} from "@noobot/session-protocol/partition-summary-checkpoints";
import {
  createSummaryCheckpointPage,
  requireSummaryCheckpointPage,
} from "@noobot/session-protocol/summary-checkpoint-page";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

function checkState(header, turnScopeId, receipts) {
  try {
    return assertTurnSummaryCheckpointState({ ...header, receipts }, turnScopeId);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

async function value(read, collection, key) {
  const entry = (await read({ collection, keys: [key] })).get(key);
  return entry === null ? null : entry.value;
}

async function head(read, turnScopeId) {
  if (!isCanonicalText(turnScopeId)) throw new TypeError("Checkpoint turn identity is required");
  const header = await value(read, "checkpointHeads", turnScopeId);
  if (header !== null) checkState(header, turnScopeId, []);
  return header;
}

async function orderAt(read, turnScopeId, revision) {
  const key = partitionCheckpointOrderKey(turnScopeId, revision);
  return requirePartitionCheckpointOrder(await value(read, "checkpointOrder", key), revision);
}

async function receiptAt(read, header, turnScopeId, revision) {
  const node = await orderAt(read, turnScopeId, revision);
  const receipt = await value(
    read,
    "checkpoints",
    JSON.stringify([turnScopeId, node.checkpointId]),
  );
  if (
    receipt === null ||
    receipt.checkpointRevision !== revision ||
    receipt.checkpointId !== node.checkpointId
  )
    corrupt("Checkpoint order disagrees with its receipt");
  checkState(header, turnScopeId, [receipt]);
  return { receipt, previousRevision: node.previousRevision };
}

async function liveHead(read, turnScopeId) {
  const header = await head(read, turnScopeId);
  const live = (
    await read({ collection: "turnCheckpoints", keys: [turnScopeId], includeOwner: true })
  ).get(turnScopeId);
  if (header === null) {
    if (live !== null && !live.mutation.remove) corrupt("Live checkpoints have no owning head");
    return null;
  }
  if (live === null) corrupt("Missing live checkpoint membership");
  const revision = live.mutation.remove
    ? null
    : requirePartitionCheckpointTail(live.mutation.value, header.checkpointRevision);
  return { header, revision };
}

async function readReceipts(read, { header, turnScopeId, revision, limit }) {
  const receipts = [];
  while (revision !== null && receipts.length < limit) {
    const entry = await receiptAt(read, header, turnScopeId, revision);
    receipts.push(entry.receipt);
    revision = entry.previousRevision;
  }
  return { receipts, nextRevision: revision };
}

export async function readPartitionCheckpointState(read, turnScopeId) {
  const live = await liveHead(read, turnScopeId);
  if (live === null) return null;
  const { receipts } = await readReceipts(read, {
    header: live.header,
    turnScopeId,
    revision: live.revision,
    limit: QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit,
  });
  return checkState(live.header, turnScopeId, receipts.reverse());
}

export async function readPartitionCheckpointPage(read, snapshot, options) {
  const scope = {
    sessionId: snapshot.sessionId,
    snapshotId: snapshot.epoch,
    generation: snapshot.sequence,
    limits: snapshot.limits,
  };
  const requestedRevision = requireSummaryCheckpointPage(scope, options);
  const { turnScopeId, limit } = options;
  const live = await liveHead(read, turnScopeId);
  if (
    requestedRevision !== null &&
    (live === null || live.revision === null || requestedRevision > live.revision)
  )
    throw new TypeError("Checkpoint cursor exceeds live revision tail");
  if (live === null) return null;
  const { receipts, nextRevision } = await readReceipts(read, {
    header: live.header,
    turnScopeId,
    revision: requestedRevision ?? live.revision,
    limit,
  });
  return createSummaryCheckpointPage(scope, options, receipts, nextRevision);
}

export async function readPartitionCheckpoint(read, turnScopeId, checkpointId) {
  if (!isCanonicalText(checkpointId)) throw new TypeError("Checkpoint identity is required");
  const header = await head(read, turnScopeId);
  const receipt = await value(read, "checkpoints", JSON.stringify([turnScopeId, checkpointId]));
  if (receipt === null) return null;
  if (header === null || receipt.checkpointId !== checkpointId)
    corrupt("Checkpoint receipt has no matching owner");
  checkState(header, turnScopeId, [receipt]);
  const node = await orderAt(read, turnScopeId, receipt.checkpointRevision);
  if (node.checkpointId !== checkpointId) corrupt("Checkpoint order disagrees with its receipt");
  return receipt;
}
