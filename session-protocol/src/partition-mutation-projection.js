/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireSessionMutationProjection } from "./aggregate/session-mutation-projection.js";
import { collectExactFieldErrors } from "./aggregate/sessions-summary.js";
import { isPlainObject } from "@noobot/shared/value";
import { resolveSessionMessageSuffixEffect } from "./aggregate/message-suffix.js";
import { SESSION_COMMAND } from "./command/session-command.js";
import { resolveMessageDeleteResultEffect } from "./command/command-receipt.js";
import {
  requirePartitionCommandReceipt,
  requirePartitionLifecycleHeader,
} from "./partition-session-state.js";
import { partitionJournalError } from "./partition-journal.js";
import {
  PARTITION_SESSION_METADATA,
  PARTITION_LIFECYCLE_HEADER,
  requirePartitionTransaction,
} from "./partition-transaction.js";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  PARTITION_SESSION_MESSAGE_COUNT,
} from "./partition-session-messages.js";
import { readPartitionReplacement } from "./partition-turn-visibility.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

export function createPartitionSuffixCommandResult(resultField, commandId, messageSuffix) {
  if (!resolveSessionMessageSuffixEffect(messageSuffix)) corrupt("Invalid command suffix");
  if (resultField === "messageDeletion") return { messageDeletionCommandId: commandId };
  if (resultField === "turnReplacement")
    return { turnReplacementCommandId: commandId, messageSuffix };
  throw new TypeError("Unknown suffix command result");
}

function createTransactionMutationReader(mutations) {
  const changes = new Map();
  for (const mutation of mutations) {
    const address = JSON.stringify([mutation.collection, mutation.key]);
    changes.set(address, mutation);
  }
  return (collection, key) => {
    const mutation = changes.get(JSON.stringify([collection, key]));
    return !mutation || mutation.remove ? null : mutation.value;
  };
}

function requireCommandSuffix(transaction, commandId, read) {
  const receipt = requirePartitionCommandReceipt(read("commands", commandId), commandId);
  const deletion = receipt.type === SESSION_COMMAND.MESSAGE_DELETE_FROM;
  if (!deletion && receipt.type !== SESSION_COMMAND.TURN_REPLACE)
    corrupt("Command has no mutation projection");
  const resultField = deletion ? "messageDeletionCommandId" : "turnReplacementCommandId";
  if (
    !isPlainObject(transaction.result) ||
    collectExactFieldErrors(
      transaction.result,
      deletion ? [resultField] : [resultField, "messageSuffix"],
    ).length ||
    transaction.result[resultField] !== commandId
  )
    corrupt("Command disagrees with its original transaction");
  const messageSuffix = deletion
    ? resolveMessageDeleteResultEffect(receipt.result)?.messageSuffix
    : transaction.result.messageSuffix;
  const suffix = resolveSessionMessageSuffixEffect(messageSuffix);
  const count = read(
    PARTITION_SESSION_MESSAGE_COUNT.collection,
    PARTITION_SESSION_MESSAGE_COUNT.key,
  );
  if (!suffix || count !== suffix.retainedMessageCount + (deletion ? 0 : 1))
    corrupt("Mutation suffix disagrees with its published count");
  return { receipt, messageSuffix };
}

async function projectMutationMessage(mutation, read, materialize) {
  const { key, remove, value } = mutation;
  if (remove || value?.message?.messageUid !== key) corrupt("Invalid mutation message identity");
  return {
    ordinal: value.sessionOrdinal,
    turnOrdinal: value.turnOrdinal,
    message: await materialize(value, read, read("lifecycle", value.message.turnScopeId)),
  };
}

async function projectMutationCollections(mutations, { read, materialize, sessionId, header }) {
  const messages = [];
  const turns = [];
  const replacements = [];
  const timings = [];
  for (const mutation of mutations) {
    const { collection, key, remove, value } = mutation;
    if (collection === collections.messages)
      messages.push(await projectMutationMessage(mutation, read, materialize));
    if (collection === "lifecycle") turns.push({ key, value: remove ? null : value });
    if (collection === "timings") timings.push({ key, value: remove ? null : value });
    if (collection === "replacements")
      replacements.push({
        key,
        value: remove
          ? null
          : await readPartitionReplacement(read, {
              sessionId,
              turnScopeId: key,
              lifecycleSequence: header.sequence,
            }),
      });
  }
  return { messages, turns, replacements, timings };
}

function requireReplacementChanges(replacements, receipt) {
  const expected = new Set(
    receipt.type === SESSION_COMMAND.TURN_REPLACE
      ? receipt.result.turnReplacement.replacedTurnScopeIds
      : [],
  );
  if (
    replacements.length !== expected.size ||
    replacements.some(
      ({ key, value }) =>
        !expected.has(key) || value === null || value.commandId !== receipt.commandId,
    )
  )
    corrupt("Mutation replacements disagree with their command receipt");
}

export async function projectPartitionMutation({
  transaction,
  generation,
  commandId,
  sessionId,
  materialize,
}) {
  requirePartitionTransaction(transaction, generation);
  const read = createTransactionMutationReader(transaction.mutations);
  const { receipt, messageSuffix } = requireCommandSuffix(transaction, commandId, read);
  const metadata = read(PARTITION_SESSION_METADATA.collection, PARTITION_SESSION_METADATA.key);
  const header = requirePartitionLifecycleHeader(
    read(PARTITION_LIFECYCLE_HEADER.collection, PARTITION_LIFECYCLE_HEADER.key),
  );
  const projected = await projectMutationCollections(transaction.mutations, {
    read,
    materialize,
    sessionId,
    header,
  });
  requireReplacementChanges(projected.replacements, receipt);
  try {
    return requireSessionMutationProjection(
      {
        kind: "commit",
        generation,
        receipt,
        baseAggregateVersion: receipt.aggregateVersion - 1,
        metadata,
        lifecycleHead: { sequence: header.sequence, activeTurnScopeId: header.activeTurnScopeId },
        messageSuffix,
        ...projected,
      },
      { sessionId },
    );
  } catch (cause) {
    if (cause.code !== "SESSION_MUTATION_PROJECTION_INVALID") throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}
