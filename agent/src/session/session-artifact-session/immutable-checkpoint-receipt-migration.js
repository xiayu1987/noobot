/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { isFunction } from "@noobot/shared/value";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import {
  requireImmutableOperationInputEvidence,
  immutableCheckpointMessageResult,
  IMMUTABLE_OPERATION_RETRY_UNAVAILABLE,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { immutableCheckpointKey } from "./immutable-checkpoint-index.js";

export function needsCheckpointReceiptMigration(result) {
  if (!result || !Object.hasOwn(result, "summaryCheckpoints")) return false;
  if (!Array.isArray(result.summaryCheckpoints))
    throw immutableStorageError("Invalid checkpoint migration results");
  return result.summaryCheckpoints.some(
    (checkpoint) =>
      !Object.hasOwn(checkpoint, "turnScopeId") || !Object.hasOwn(checkpoint, "messages"),
  );
}

async function validateOriginMessages(source, references, request, { identities, signal }) {
  for (const uid of identities) {
    signal?.throwIfAborted();
    const reference = references.get(uid);
    if (!reference)
      throw immutableStorageError("Checkpoint message is absent from its origin commit");
    const { value } = await source.objects.readValueMetadata(reference);
    if (
      value.message?.messageUid !== uid ||
      value.message.sessionId !== source.sessionId ||
      value.message.turnScopeId !== request.turnScopeId ||
      value.message.dialogProcessId !== request.dialogProcessId
    )
      throw immutableStorageError("Checkpoint migration message ownership mismatch");
  }
}

async function validateCommitOrigins(source, record, pending, signal) {
  let references;
  for (const mutation of record.mutations) {
    signal?.throwIfAborted();
    if (mutation.collection !== "checkpoints") continue;
    const matches = pending.get(mutation.key);
    if (!matches) continue;
    if (!mutation.reference)
      throw immutableStorageError("Checkpoint migration receipt disagrees with its origin");
    const origin = await source.objects.readValue(mutation.reference);
    references ??= new Map(
      record.mutations
        .filter((entry) => entry.collection === "messages")
        .map((entry) => [entry.key, entry.reference]),
    );
    for (const { request, result, identities } of matches) {
      if (!isDeepStrictEqual(origin, result.receipt))
        throw immutableStorageError("Checkpoint migration receipt disagrees with its origin");
      await validateOriginMessages(source, references, request, { identities, signal });
    }
    pending.delete(mutation.key);
  }
}

async function validateOrigins(source, record, checkpoints, signal) {
  const pending = new Map();
  for (const checkpoint of checkpoints) {
    const { request } = checkpoint;
    const key = immutableCheckpointKey(request.turnScopeId, request.checkpointId);
    const matches = pending.get(key) ?? [];
    matches.push(checkpoint);
    pending.set(key, matches);
  }
  while (record && pending.size) {
    signal?.throwIfAborted();
    await validateCommitOrigins(source, record, pending, signal);
    if (!pending.size) return;
    record =
      record.previous === null
        ? null
        : await source.readCommitRecord(record.previous, record.generation - 1);
  }
  if (pending.size) throw immutableStorageError("Checkpoint migration origin is missing");
}

function migrateCheckpointResult(checkpoint, result, sessionId) {
  const request = parseTurnSummaryCheckpointRequest(checkpoint);
  if (
    request.sessionId !== sessionId ||
    result.receipt?.checkpointId !== request.checkpointId ||
    result.receipt.requestHash !== request.requestHash ||
    result.receipt.checkpointRevision !== request.expectedCheckpointRevision + 1
  )
    throw immutableStorageError("Checkpoint migration request ownership mismatch");
  const messages = immutableCheckpointMessageResult(request);
  if (
    (Object.hasOwn(result, "turnScopeId") && result.turnScopeId !== request.turnScopeId) ||
    (Object.hasOwn(result, "messages") && !isDeepStrictEqual(result.messages, messages))
  )
    throw immutableStorageError("Checkpoint migration conflicts with persisted identity");
  return {
    origin: { request, result, identities: messages },
    result: { ...result, turnScopeId: request.turnScopeId, messages },
  };
}

export async function migrateCheckpointReceipts({
  source,
  receipt,
  operationId,
  readOperationInput,
  signal,
}) {
  if (receipt.retryUnavailable || !needsCheckpointReceiptMigration(receipt.result)) return receipt;
  const evidence = isFunction(readOperationInput) ? await readOperationInput(operationId) : null;
  signal?.throwIfAborted();
  if (evidence === null || evidence === undefined)
    return { ...receipt, retryUnavailable: IMMUTABLE_OPERATION_RETRY_UNAVAILABLE };
  const input = requireImmutableOperationInputEvidence(receipt, evidence);
  const requests = input?.changes?.summaryCheckpoints;
  if (!Array.isArray(requests) || requests.length !== receipt.result.summaryCheckpoints.length)
    throw immutableStorageError("Checkpoint migration input result count mismatch");
  const record = await source.readCommitRecord(receipt.commit, receipt.generation);
  if (record.operationId !== operationId)
    throw immutableStorageError("Checkpoint migration operation ownership mismatch");
  const summaryCheckpoints = [];
  const origins = [];
  for (const [index, checkpoint] of requests.entries()) {
    const migrated = migrateCheckpointResult(
      checkpoint,
      receipt.result.summaryCheckpoints[index],
      source.sessionId,
    );
    origins.push(migrated.origin);
    summaryCheckpoints.push(migrated.result);
  }
  await validateOrigins(source, record, origins, signal);
  return { ...receipt, result: { ...receipt.result, summaryCheckpoints } };
}
