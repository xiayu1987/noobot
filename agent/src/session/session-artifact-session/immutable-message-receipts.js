/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";
import {
  IMMUTABLE_COMMIT_INDEX_VERSION,
  requireImmutableMessageResult,
  requireImmutableCommitOrigin,
  requireImmutableMessageContentPart,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableCheckpointKey } from "./immutable-checkpoint-index.js";

export async function readCommittedMessageReceipts(store, outcome, identities) {
  requireImmutableMessageResult(identities);
  const record = await store.readCommitRecord(outcome.commit, outcome.generation);
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
      value: { message },
      parts,
    } = metadata[index];
    if (message.messageUid !== uid || message.sessionId !== store.sessionId)
      throw immutableStorageError("Message result commit ownership mismatch");
    const content = requireImmutableMessageContentPart(parts);
    receipts.push(createMessagePersistenceReceipt(message, outcome.generation, content.reference));
  }
  return receipts;
}

export async function readCheckpointMessageReceipts(store, checkpoint) {
  const snapshot = await store.snapshot();
  const header = await store.get(snapshot, "metadata", "commitIndex");
  if (header?.version !== IMMUTABLE_COMMIT_INDEX_VERSION)
    throw Object.assign(new Error("Immutable commit indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  const key = immutableCheckpointKey(checkpoint.turnScopeId, checkpoint.receipt.checkpointId);
  const origin = await store.get(snapshot, "checkpointCommits", key);
  requireImmutableCommitOrigin(origin, snapshot.generation);
  const commit = await store.readCommitReference(snapshot, origin.generation);
  if (!commit) throw immutableStorageError("Checkpoint origin commit is missing");
  const record = await store.readCommitRecord(commit, origin.generation);
  const mutation = record.mutations.find(
    (entry) => entry.collection === "checkpoints" && entry.key === key,
  );
  if (!mutation?.reference)
    throw immutableStorageError("Checkpoint is missing from its origin commit");
  const receipt = await store.objects.readValue(mutation.reference);
  if (JSON.stringify(receipt) !== JSON.stringify(checkpoint.receipt))
    throw immutableStorageError("Checkpoint receipt disagrees with its origin commit");
  return readCommittedMessageReceipts(
    store,
    { commit, generation: origin.generation },
    checkpoint.messages,
  );
}
