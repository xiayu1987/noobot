/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { summaryCheckpointEffectMessageUids } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  partitionCheckpointOrderKey,
  requirePartitionCheckpointOrder,
  requirePartitionCheckpointTail,
} from "@noobot/session-protocol/partition-summary-checkpoints";
import { checkPartitionMessageStorage } from "./partition-message-record.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

function remove(mutations, collection, key, stored) {
  mutations.push({ collection, key, owner: stored.owner, remove: true });
}

function checkState(head, turnScopeId, receipts) {
  try {
    assertTurnSummaryCheckpointState({ ...head, receipts }, turnScopeId);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

async function touchesRemovedMessage({ lookup, snapshot, scope, view }, receipt, tail) {
  const uids = summaryCheckpointEffectMessageUids(receipt);
  for (const messageUid of uids) {
    const stored = await lookup({ collection: "messages", key: messageUid });
    if (stored === null || stored.mutation.remove)
      corrupt("Checkpoint references a missing message");
    const record = checkPartitionMessageStorage(stored.mutation.value, {
      snapshot,
      scope,
      messageUid,
      generation: view.generation,
    });
    if (record.message.turnScopeId !== tail.key)
      corrupt("Checkpoint message belongs to another turn");
    if (record.turnOrdinal > tail.value.messageCount) return true;
  }
  return false;
}

function relink(mutations, pending, previousRevision) {
  if (!pending || pending.stored.mutation.value.previousRevision === previousRevision) return;
  mutations.push({
    collection: "checkpointOrder",
    key: pending.key,
    owner: pending.stored.owner,
    value: { ...pending.stored.mutation.value, previousRevision },
  });
}

async function cleanTurnCheckpoints(options, tail, head, live) {
  const { lookup, mutations } = options;
  let revision = requirePartitionCheckpointTail(
    live.mutation.value,
    head.mutation.value.checkpointRevision,
  );
  let latest = null;
  let pending = null;
  while (revision !== null) {
    const orderKey = partitionCheckpointOrderKey(tail.key, revision);
    const order = await lookup({ collection: "checkpointOrder", key: orderKey });
    if (order === null || order.mutation.remove) corrupt("Missing live checkpoint revision order");
    const node = requirePartitionCheckpointOrder(order.mutation.value, revision);
    const key = JSON.stringify([tail.key, node.checkpointId]);
    const stored = await lookup({ collection: "checkpoints", key });
    if (stored === null || stored.mutation.remove)
      corrupt("Checkpoint order references a missing receipt");
    const receipt = stored.mutation.value;
    checkState(head.mutation.value, tail.key, [receipt]);
    if (receipt.checkpointRevision !== revision || receipt.checkpointId !== node.checkpointId)
      corrupt("Checkpoint revision order disagrees with its receipt");
    if (tail.remove || (await touchesRemovedMessage(options, receipt, tail))) {
      remove(mutations, "checkpoints", key, stored);
      remove(mutations, "checkpointOrder", orderKey, order);
      revision = node.previousRevision;
      continue;
    }
    if (latest === null) latest = revision;
    relink(mutations, pending, revision);
    pending = { key: orderKey, stored: order };
    revision = node.previousRevision;
  }
  relink(mutations, pending, null);
  if (latest === null) remove(mutations, "turnCheckpoints", tail.key, live);
  else if (latest !== live.mutation.value)
    mutations.push({
      collection: "turnCheckpoints",
      key: tail.key,
      owner: live.owner,
      value: latest,
    });
}

export async function preparePartitionCheckpointDeletion(options) {
  const { lookup, mutations, tails } = options;
  for (const tail of tails) {
    const head = await lookup({ collection: "checkpointHeads", key: tail.key });
    if (head === null || head.mutation.remove) continue;
    checkState(head.mutation.value, tail.key, []);
    const live = await lookup({ collection: "turnCheckpoints", key: tail.key });
    if (live === null) corrupt("Missing live checkpoint membership");
    if (!live.mutation.remove) await cleanTurnCheckpoints(options, tail, head, live);
    if (tail.remove) remove(mutations, "checkpointHeads", tail.key, head);
  }
}
