/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  createPartitionMutationReader,
  PARTITION_LIFECYCLE_HEADER,
  requirePartitionOutboxTail,
} from "@noobot/session-protocol/partition-transaction";
import { commitIndexedTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  readPartitionCommandReceipt,
  requirePartitionLifecycleHeader,
} from "@noobot/session-protocol/partition-session-state";
import { materializeTurnTerminalMessages } from "@noobot/session-protocol";
import {
  readPartitionLifecycleTurn,
  readPartitionReplacement,
} from "@noobot/session-protocol/partition-turn-visibility";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import {
  assertAuthorityEventSequenceAdvance,
  assertNewAuthorityEventScope,
  decodeStoredAuthorityOutboxEvent,
  encodeStoredAuthorityOutboxEvent,
  normalizeAuthorityEventOutbox,
  authorityOutboxPositionKey,
  appendAuthorityOutboxTurnRange,
  requireAuthorityOutboxTurnRange,
} from "@noobot/event-protocol/outbox";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";

export async function preparePartitionTurnTransition({
  view,
  scope,
  event,
  committedAt,
  snapshot,
}) {
  if (event.sessionId !== scope.sessionId)
    throw new PartitionAdmissionRejection(
      "SESSION_SCOPE_IDENTITY_CONFLICT",
      "Lifecycle session ownership mismatch",
    );
  const lookup = async (collection, key) => {
    const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
    return entry?.mutation.remove ? null : entry;
  };
  const read = async (collection, key) => {
    const entry = await lookup(collection, key);
    return entry === null ? null : entry.mutation.value;
  };
  const readMembership = createPartitionMutationReader(view.getLatestMany);
  const turns = new Map();
  const readTurn = async (key) => {
    if (!turns.has(key))
      turns.set(
        key,
        await readPartitionLifecycleTurn(readMembership, key, (record, messageUid) =>
          checkPartitionMessageStorage(record, {
            snapshot,
            scope,
            messageUid,
            generation: view.generation,
          }),
        ),
      );
    return turns.get(key);
  };
  const header = await lookup(
    PARTITION_LIFECYCLE_HEADER.collection,
    PARTITION_LIFECYCLE_HEADER.key,
  );
  const lifecycleHeader = requirePartitionLifecycleHeader(header?.mutation.value);
  const result = await commitIndexedTurnLifecycle({
    header: lifecycleHeader,
    event,
    now: () => committedAt,
    createEventId: randomUUID,
    parentSessionId: scope.parentSessionId,
    readTurn,
    readReplacement: (key) =>
      readPartitionReplacement(read, {
        sessionId: scope.sessionId,
        turnScopeId: key,
        lifecycleSequence: lifecycleHeader.sequence,
      }),
    readCommand: (key) => readPartitionCommandReceipt(readMembership, key),
    isCommittedEventId: async (key) => (await read("events", key)) !== null,
    readPreparedEvent: async (key) => {
      const record = await read("events", key);
      if (record === null)
        throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Lifecycle receipt has no event");
      const { ordinal: _ordinal, ...event } = decodeStoredAuthorityOutboxEvent(record);
      if (event.eventId !== key)
        throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Lifecycle event identity mismatch");
      return event;
    },
    materializeTerminal: async ({ terminalStatus, previousSummaryVersion }) => {
      const turn = await read("turns", terminalStatus.turnScopeId);
      if (turn !== null && turn.dialogProcessId !== terminalStatus.dialogProcessId)
        return { materialized: false, reason: "turn_execution_identity_conflict" };
      return materializeTurnTerminalMessages({
        messages: [],
        terminalStatus,
        previousSummaryVersion,
      });
    },
  });
  if (!result.applied) return { result, mutations: [] };
  const [record] = normalizeAuthorityEventOutbox([{ ...result.committedEvent, deliveries: {} }]);
  assertNewAuthorityEventScope(record, scope);
  assertAuthorityEventSequenceAdvance(record.envelope, lifecycleHeader.sequence);
  if (record.envelope.ordering.sequence !== result.header.sequence)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Lifecycle event sequence mismatch");
  const previousOrdinal = requirePartitionOutboxTail(lifecycleHeader);
  const ordinal = previousOrdinal + 1;
  const turnScopeId = record.envelope.identity.turnScopeId;
  const previousRange = await lookup("turnOutbox", turnScopeId);
  let range;
  try {
    if (previousRange === null && (await read("lifecycle", turnScopeId)) !== null)
      throw new TypeError("Missing partition outbox turn range");
    if (previousRange !== null)
      requireAuthorityOutboxTurnRange(previousRange.mutation.value, turnScopeId, previousOrdinal);
    range = appendAuthorityOutboxTurnRange(
      previousRange === null ? null : previousRange.mutation.value,
      turnScopeId,
      ordinal,
    );
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
  const mutations = [
    {
      collection: "turnOutbox",
      key: turnScopeId,
      value: range,
      owner: previousRange?.owner ?? null,
    },
    {
      ...PARTITION_LIFECYCLE_HEADER,
      value: { ...result.header, outboxTail: ordinal },
      owner: header.owner,
    },
    { collection: "commands", key: event.commandId, value: result.commandReceipt, owner: null },
    {
      collection: "events",
      key: record.eventId,
      value: encodeStoredAuthorityOutboxEvent({ ...record, ordinal }),
      owner: null,
    },
    {
      collection: "eventOrder",
      key: authorityOutboxPositionKey(ordinal),
      value: record.eventId,
      owner: null,
    },
  ];
  for (const turn of result.changedTurns) {
    const stored = await lookup("lifecycle", turn.turnScopeId);
    mutations.push({
      collection: "lifecycle",
      key: turn.turnScopeId,
      value: turn,
      owner: stored?.owner ?? null,
    });
  }
  return { result, mutations };
}
