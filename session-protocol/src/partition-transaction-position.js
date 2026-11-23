/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./errors.js";

export const PARTITION_TRANSACTION_FORMAT = "noobot.partition-transaction/7";

export function partitionTransactionPosition(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw partitionJournalError("SESSION_GENERATION_CONFLICT", "Transaction generation mismatch");
  return { format: PARTITION_TRANSACTION_FORMAT, expectedGeneration: sequence - 1 };
}

export function requirePartitionTransactionPosition(transaction, sequence) {
  if (transaction.format !== PARTITION_TRANSACTION_FORMAT)
    throw new TypeError("Unknown partition transaction format");
  if (transaction.expectedGeneration !== partitionTransactionPosition(sequence).expectedGeneration)
    throw partitionJournalError("SESSION_GENERATION_CONFLICT", "Transaction generation mismatch");
}
