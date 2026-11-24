/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireSessionOperationId } from "./session-changes.js";
import { requireHistoricalStorageDigest, sessionStorageError } from "./session-storage-format.js";

export function assertHistoricalOperationRetryMatches(receipt, operationId, digest) {
  if (receipt.retryUnavailable === "original-input-unavailable")
    throw Object.assign(
      new Error("Historical operation retry is unavailable; operation was not re-executed"),
      {
        code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
        operationId,
        generation: receipt.generation,
        reason: receipt.retryUnavailable,
      },
    );
  if (receipt.digest !== digest)
    throw Object.assign(new Error("operationId reused with different changes"), {
      code: "SESSION_OPERATION_CONFLICT",
    });
}

export function requirePartitionHistoricalOperation(evidence, operationId) {
  requireSessionOperationId(operationId);
  if (
    !isPlainObject(evidence) ||
    Object.keys(evidence).length !== 3 ||
    evidence.format !== "noobot.immutable-migration-operation/1" ||
    evidence.operationId !== operationId ||
    !Object.hasOwn(evidence, "receipt")
  )
    throw sessionStorageError("Invalid stored partition historical operation");
  const { receipt } = evidence;
  if (
    !isPlainObject(receipt) ||
    Object.keys(receipt).some(
      (key) => !["generation", "commit", "digest", "result", "retryUnavailable"].includes(key),
    ) ||
    !Number.isSafeInteger(receipt.generation) ||
    receipt.generation < 1 ||
    (Object.hasOwn(receipt, "retryUnavailable") &&
      (receipt.retryUnavailable !== "original-input-unavailable" ||
        !Object.hasOwn(receipt, "result")))
  )
    throw sessionStorageError("Invalid stored partition historical receipt");
  requireHistoricalStorageDigest(receipt.digest);
  requireHistoricalStorageDigest(receipt.commit);
  return evidence;
}
