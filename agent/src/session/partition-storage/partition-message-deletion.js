/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitIndexedTurnDeletion } from "@noobot/authoritative-state/application";
import { artifactRetirementKey } from "@noobot/event-protocol/plugin-artifact-event";
import {
  applySessionMetadataCommit,
  createAggregateVersionConflictError,
  createMessageDeleteFingerprint,
  createMessageDeleteResult,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  matchesAttachmentBindingReceipt,
  parseMessageDeleteRequest,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  PARTITION_SESSION_MESSAGE_COUNT,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import {
  PARTITION_LIFECYCLE_HEADER,
  PARTITION_SESSION_METADATA,
  requirePartitionOutboxTail,
} from "@noobot/session-protocol/partition-transaction";
import {
  requirePartitionCommandReceipt,
  requirePartitionLifecycleHeader,
} from "@noobot/session-protocol/partition-session-state";
import { preparePartitionOutboxRetirement } from "./partition-outbox.js";
import { preparePartitionCheckpointDeletion } from "./partition-checkpoint-deletion.js";
import { removePartitionDialogMessages } from "@noobot/session-protocol/partition-session-dialogs";
import { createPartitionSuffixCommandResult } from "@noobot/session-protocol/partition-mutation-projection";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

function change(address, stored, value) {
  return {
    ...address,
    owner: stored === null ? null : stored.owner,
    ...(value === undefined ? { remove: true } : { value }),
  };
}

function removeSuffixPage(records, turns, tails) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const { turnOrdinal, message } = records[index];
    const { turnScopeId } = message;
    if (!tails.has(turnScopeId)) {
      const turn = turns.get(turnScopeId);
      tails.set(turnScopeId, { turn, messageCount: turn.mutation.value.messageCount });
    }
    const tail = tails.get(turnScopeId);
    if (turnOrdinal !== tail.messageCount)
      corrupt("Message deletion does not remove a turn suffix");
    tail.messageCount -= 1;
    tails.delete(turnScopeId);
    tails.set(turnScopeId, tail);
  }
}

async function prepareSuffixTails(read, suffix, readSuffixPages) {
  const tails = new Map();
  const dialogs = new Map();
  const retiredMessages = [];
  let anchorUid;
  for await (const records of readSuffixPages(suffix)) {
    await removePartitionDialogMessages(read, records, dialogs);
    for (const record of records) retiredMessages.push(record);
    const { turns } = await requirePartitionVisibleMessageTurnOwnership(read, records);
    removeSuffixPage(records, turns, tails);
    if (records.length) anchorUid = records[0].message.messageUid;
  }
  if (anchorUid !== suffix.anchor.messageUid)
    corrupt("Message deletion anchor disagrees with session order");
  const turnTails = [...tails]
    .reverse()
    .map(([key, { turn, messageCount }]) =>
      change(
        { collection: collections.turns, key },
        turn,
        messageCount ? { ...turn.mutation.value, messageCount } : undefined,
      ),
    );
  const dialogMutations = [...dialogs.values()].map(({ value, ...mutation }) => ({
    ...mutation,
    ...(value.messageCount ? { value } : { remove: true }),
  }));
  return { turnTails, dialogMutations, retiredMessages };
}

async function retireSuffixBindings(lookup, mutations, removedRecords) {
  for (const record of removedRecords) {
    if (!Object.hasOwn(record, "attachmentBindingCommandId")) continue;
    const key = record.attachmentBindingCommandId;
    const address = { collection: "commands", key };
    const stored = await lookup(address);
    if (!matchesAttachmentBindingReceipt(stored?.mutation.value, key, record.message))
      corrupt("Deleted message disagrees with its attachment binding receipt");
    mutations.push(change(address, stored));
  }
}

async function resolveSuffixCommandReplay(lookup, { command, type, requestHash, resultField }) {
  const { commandId } = command;
  const commandAddress = { collection: "commands", key: commandId };
  const previous = await lookup(commandAddress);
  const previousReceipt =
    previous === null || previous.mutation.remove
      ? null
      : requirePartitionCommandReceipt(previous.mutation.value, commandId);
  const decision = decideCommandIdempotency({
    commandId,
    type,
    requestHash,
    receipts: previousReceipt === null ? [] : [previousReceipt],
  });
  if (!decision.allowed || previous?.mutation.remove)
    throw Object.assign(
      new PartitionAdmissionRejection(
        SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
        "commandId was reused with a different request",
      ),
      { statusCode: 409 },
    );
  return {
    previous,
    commandAddress,
    replay: decision.deduplicated
      ? {
          action: "abort",
          result: { [resultField]: { receipt: decision.receipt, deduplicated: true } },
        }
      : null,
  };
}

async function requireSuffixCommandConcurrency(lookup, command) {
  const metadata = await lookup(PARTITION_SESSION_METADATA);
  if (metadata === null || metadata.mutation.remove) corrupt("Missing partition session metadata");
  const { aggregateVersion } = metadata.mutation.value;
  const concurrency = decideAggregateConcurrency({
    aggregateVersion,
    expectedAggregateVersion: command.expectedAggregateVersion,
  });
  if (!concurrency.allowed) {
    const error = createAggregateVersionConflictError({ currentVersion: aggregateVersion });
    throw Object.assign(new PartitionAdmissionRejection(error.code, error.message), error);
  }
  return { metadata, concurrency };
}

export async function preparePartitionSuffixCommand({
  view,
  read,
  scope,
  snapshot,
  command,
  type,
  requestHash,
  resultField,
  committedAt,
  findSuffix,
  readSuffixPages,
  prepareLifecycle,
}) {
  const { commandId } = command;
  const lookup = async ({ collection, key }) =>
    (await view.getLatestMany({ collection, keys: [key] })).get(key);
  const { previous, commandAddress, replay } = await resolveSuffixCommandReplay(lookup, {
    command,
    type,
    requestHash,
    resultField,
  });
  if (replay) return replay;
  const { metadata, concurrency } = await requireSuffixCommandConcurrency(lookup, command);
  const suffix = await findSuffix(command.anchor.turnScopeId);
  if (suffix === null)
    throw Object.assign(
      new PartitionAdmissionRejection("SESSION_MESSAGE_NOT_FOUND", "message anchor not found"),
      { statusCode: 404 },
    );
  const {
    turnTails: tails,
    dialogMutations,
    retiredMessages,
  } = await prepareSuffixTails(read, suffix, readSuffixPages);
  const turnScopeIds = tails.map(({ key }) => key);
  const header = await lookup(PARTITION_LIFECYCLE_HEADER);
  const lifecycleHeader = requirePartitionLifecycleHeader(
    header?.mutation.remove ? undefined : header?.mutation.value,
  );
  const outboxTail = requirePartitionOutboxTail(lifecycleHeader);
  const lifecycleEntries = new Map();
  const { lifecycle, result, appendedMutations, messageCount } = await prepareLifecycle({
    suffix,
    lookup,
    aggregateVersion: concurrency.nextAggregateVersion,
    header: lifecycleHeader,
    turnScopeIds,
    readTurn: async (key) => {
      const entry = await lookup({ collection: "lifecycle", key });
      lifecycleEntries.set(key, entry);
      return entry === null || entry.mutation.remove ? null : entry.mutation.value;
    },
  });
  const changedTurnIds = new Set(lifecycle.changedTurns.map(({ turnScopeId }) => turnScopeId));
  const mutations = [
    ...appendedMutations,
    ...dialogMutations,
    ...tails,
    change(
      PARTITION_SESSION_MESSAGE_COUNT,
      await lookup(PARTITION_SESSION_MESSAGE_COUNT),
      messageCount,
    ),
    change(PARTITION_LIFECYCLE_HEADER, header, { ...lifecycle.header, outboxTail }),
  ];
  await preparePartitionCheckpointDeletion({ lookup, mutations, tails, snapshot, scope, view });
  await retireSuffixBindings(lookup, mutations, retiredMessages);
  await preparePartitionOutboxRetirement({
    view,
    mutations,
    snapshot,
    turnScopeIds,
  });
  for (const key of turnScopeIds) {
    const retirement = { collection: "metadata", key: artifactRetirementKey(key) };
    mutations.push(change(retirement, await lookup(retirement), outboxTail));
    if (changedTurnIds.has(key)) continue;
    const entry = lifecycleEntries.get(key);
    if (entry === null || !entry.mutation.remove)
      mutations.push(change({ collection: "lifecycle", key }, entry));
  }
  for (const turn of lifecycle.changedTurns)
    mutations.push(
      change(
        { collection: "lifecycle", key: turn.turnScopeId },
        lifecycleEntries.get(turn.turnScopeId),
        turn,
      ),
    );
  for (const { key, remove } of tails) {
    if (!remove) continue;
    const address = { collection: "timings", key };
    const timing = await lookup(address);
    if (timing !== null && !timing.mutation.remove) mutations.push(change(address, timing));
  }
  const receipt = {
    type,
    commandId,
    requestHash,
    aggregateVersion: concurrency.nextAggregateVersion,
    committedAt,
    result,
  };
  mutations.push(
    change(
      PARTITION_SESSION_METADATA,
      metadata,
      applySessionMetadataCommit(metadata.mutation.value, {
        aggregateVersion: receipt.aggregateVersion,
        committedAt,
      }),
    ),
    change(commandAddress, previous, receipt),
  );
  return {
    action: "commit",
    mutations,
    retiredMessages,
    result: createPartitionSuffixCommandResult(resultField, commandId, suffix.messageSuffix),
  };
}

export function preparePartitionMessageDeletion({ request, ...options }) {
  const command = parseMessageDeleteRequest(request);
  return preparePartitionSuffixCommand({
    ...options,
    command,
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    requestHash: createMessageDeleteFingerprint(command),
    resultField: "messageDeletion",
    async prepareLifecycle({ suffix, header, turnScopeIds, readTurn }) {
      const lifecycle = await commitIndexedTurnDeletion({ header, turnScopeIds, readTurn });
      if (!lifecycle.applied) corrupt("Partition lifecycle rejected message deletion");
      return {
        lifecycle,
        result: createMessageDeleteResult(suffix.messageSuffix, turnScopeIds),
        appendedMutations: [],
        messageCount: suffix.retainedMessageCount,
      };
    },
  });
}
