/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireImmutableContentDigest } from "./immutable-segment.js";
import { requireSessionOperationId } from "./session-changes.js";
import {
  immutableStorageError,
  captureImmutableMigrationSourceIdentity,
  immutableSessionReferenceContract,
  requireObjectReference,
} from "./immutable-storage.js";

export const IMMUTABLE_OPERATION_RETRY_UNAVAILABLE = "original-input-unavailable";

export function assertImmutableOperationRetryAvailable(receipt, operationId) {
  if (receipt.retryUnavailable === IMMUTABLE_OPERATION_RETRY_UNAVAILABLE)
    throw Object.assign(
      new Error("Historical operation retry is unavailable; operation was not re-executed"),
      {
        code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
        operationId,
        generation: receipt.generation,
        reason: receipt.retryUnavailable,
      },
    );
}

export function assertImmutableOperationRetryMatches(receipt, operationId, digest) {
  assertImmutableOperationRetryAvailable(receipt, operationId);
  if (receipt.digest !== digest)
    throw Object.assign(new Error("operationId reused with different changes"), {
      code: "SESSION_OPERATION_CONFLICT",
    });
}

export function requireImmutableOperationReceipt(
  receipt,
  generation,
  requireReference = requireObjectReference,
) {
  if (
    !isPlainObject(receipt) ||
    Object.keys(receipt).some(
      (key) => !["generation", "commit", "digest", "result", "retryUnavailable"].includes(key),
    ) ||
    (Object.hasOwn(receipt, "retryUnavailable") &&
      (receipt.retryUnavailable !== IMMUTABLE_OPERATION_RETRY_UNAVAILABLE ||
        !Object.hasOwn(receipt, "result"))) ||
    !Number.isSafeInteger(receipt.generation) ||
    receipt.generation < 1 ||
    receipt.generation > generation
  )
    throw immutableStorageError("Invalid immutable operation receipt");
  requireImmutableContentDigest(receipt.digest);
  requireReference(receipt.commit);
  return receipt;
}

const IMMUTABLE_MIGRATION_OPERATION_FORMAT = "noobot.immutable-migration-operation/1";

export function requireImmutableMigrationOperation(evidence, operationId) {
  requireSessionOperationId(operationId);
  if (
    !isPlainObject(evidence) ||
    Object.keys(evidence).length !== 3 ||
    evidence.format !== IMMUTABLE_MIGRATION_OPERATION_FORMAT ||
    evidence.operationId !== operationId ||
    !Object.hasOwn(evidence, "receipt")
  )
    throw immutableStorageError("Invalid migration operation evidence");
  requireImmutableOperationReceipt(evidence.receipt, Number.MAX_SAFE_INTEGER);
  return evidence;
}

export async function visitPinnedImmutableMigrationOperations(source, visit) {
  const identity = captureImmutableMigrationSourceIdentity(source.identity);
  const requireReference = immutableSessionReferenceContract(identity.format);
  let generation = 0;
  await source.visitOperations(async (operation) => {
    const evidence = requireImmutableMigrationOperation(operation, operation?.operationId);
    const { receipt } = evidence;
    generation += 1;
    requireReference(receipt.commit);
    if (receipt.generation !== generation || generation > identity.generation)
      throw immutableStorageError("Migration operation stream is not in pinned generation order");
    if (generation === identity.generation && receipt.commit !== identity.commit)
      throw immutableStorageError("Migration operation stream disagrees with its pinned head");
    await visit(evidence);
  });
  if (generation !== identity.generation)
    throw immutableStorageError("Migration operation stream ended before its pinned head");
  return identity;
}

export function createImmutableMigrationOperation({ generation, operationId }, operation) {
  requireSessionOperationId(operationId);
  if (
    operation === null ||
    operation.record.operationId !== operationId ||
    operation.record.generation !== generation ||
    operation.receipt.generation !== generation
  )
    throw Object.assign(new Error("Migration commit has no matching operation receipt"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  return {
    format: IMMUTABLE_MIGRATION_OPERATION_FORMAT,
    operationId,
    receipt: operation.receipt,
  };
}
