/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";
import {
  requireImmutableCheckpointOriginGeneration,
  requireImmutableMessageResult,
  requireImmutableMessageContentPart,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableCheckpointKey } from "./immutable-checkpoint-index.js";

export async function projectImmutableSessionCommitResult(store, snapshot, record, stored) {
  const { messages, ...result } = stored;
  if (Object.hasOwn(stored, "messages"))
    result.messageReceipts = await readCommittedMessageReceipts(store, record, messages);
  if (Object.hasOwn(stored, "summaryCheckpoints")) {
    result.summaryCheckpoints = await Promise.all(
      stored.summaryCheckpoints.map(async (checkpoint) => {
        const { messages, turnScopeId, originGeneration, ...value } = checkpoint;
        return {
          ...value,
          messageReceipts: await readCheckpointMessageReceipts(store, snapshot, record, checkpoint),
        };
      }),
    );
  }
  return result;
}

async function readCommittedMessageReceipts(store, record, identities) {
  requireImmutableMessageResult(identities);
  if (record === null) throw immutableStorageError("Message result has no committed generation");
  const references = new Map(
    record.mutations
      .filter((mutation) => mutation.collection === "messages")
      .map((mutation) => [mutation.key, mutation.reference]),
  );
  const selected = identities.map((uid) => {
    const reference = references.get(uid);
    if (!reference)
      throw immutableStorageError("Message result is missing from its committed generation");
    return reference;
  });
  const metadata = await store.objects.readValuesMetadata(selected);
  const receipts = [];
  for (const [index, uid] of identities.entries()) {
    const {
      value: { message, ordinal },
      parts,
    } = metadata[index];
    if (message.messageUid !== uid || message.sessionId !== store.sessionId)
      throw immutableStorageError("Message result commit ownership mismatch");
    const content = requireImmutableMessageContentPart(parts);
    receipts.push(
      createMessagePersistenceReceipt(message, record.generation, content.reference, ordinal),
    );
  }
  return receipts;
}

async function readCheckpointOrigin(store, snapshot, generation) {
  const commit = await store.readCommitReference(snapshot, generation);
  if (!commit) throw immutableStorageError("Checkpoint origin commit is missing");
  return store.readCommitRecord(commit, generation);
}

function findCheckpointMutation(record, key) {
  return record.mutations.find((entry) => entry.collection === "checkpoints" && entry.key === key);
}

async function readCheckpointMessageReceipts(store, snapshot, operation, checkpoint) {
  const key = immutableCheckpointKey(checkpoint.turnScopeId, checkpoint.receipt.checkpointId);
  let record = operation;
  if (checkpoint.deduplicated === true) {
    const generation = requireImmutableCheckpointOriginGeneration(
      checkpoint.originGeneration,
      operation === null ? snapshot.generation : operation.generation,
    );
    if (operation?.generation !== generation)
      record = await readCheckpointOrigin(store, snapshot, generation);
  }
  if (record === null) throw immutableStorageError("Checkpoint result has no committed generation");
  const mutation = findCheckpointMutation(record, key);
  if (!mutation?.reference)
    throw immutableStorageError("Checkpoint is missing from its origin commit");
  const receipt = await store.objects.readValue(mutation.reference);
  if (!isDeepStrictEqual(receipt, checkpoint.receipt))
    throw immutableStorageError("Checkpoint receipt disagrees with its origin commit");
  return readCommittedMessageReceipts(store, record, checkpoint.messages);
}
