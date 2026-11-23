/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  appendAuthorityOutboxTurnRange,
  AUTHORITY_OUTBOX_PAGE_LIMIT,
  authorityOutboxPositionKey,
  encodeStoredAuthorityOutboxEvent,
  normalizeAuthorityEventOutbox,
  removeAuthorityOutboxTurnRange,
  requireAuthorityEventSequenceFloor,
} from "@noobot/event-protocol/outbox";
import {
  isArtifactRetirementKey,
  requireCommittedArtifactRetirement,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
  PARTITION_SESSION_ARTIFACT_EVENTS,
} from "@noobot/session-protocol/partition-collections";
import { sessionLifecycleSequenceKey } from "@noobot/session-protocol/turn-lifecycle";
import { createPartitionIndexMutations } from "../session/partition-storage/partition-index-mutations.js";
import {
  isCanonicalCommandReceipt,
  matchesAttachmentBindingReceipt,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { requirePageBounds } from "@noobot/session-protocol/message-read-budget";
import { partitionTransactionSubmissionRecords } from "@noobot/session-protocol/partition-journal";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { partitionCheckpointOrderKey } from "@noobot/session-protocol/partition-summary-checkpoints";
import {
  assertPartitionInitializationScope,
  preparePartitionSessionImport,
} from "@noobot/session-protocol/partition-session-initialization";
import {
  PARTITION_LIFECYCLE_HEADER,
  PARTITION_SESSION_METADATA,
} from "@noobot/session-protocol/partition-transaction";
import { createPartitionReplacementReference } from "@noobot/session-protocol/partition-turn-visibility";
import { preparePartitionDisplayTransaction } from "../session/partition-storage/partition-display-transaction.js";
import { readPartitionMessageTransitions } from "../session/partition-storage/partition-message-transitions.js";
import { seedPartitionDisplayPublication } from "../session/partition-storage/partition-display-publication.js";
import { preparePartitionLifecycleIndex } from "../session/partition-storage/partition-lifecycle-index.js";
import { PartitionSessionMessages } from "../session/partition-storage/partition-session-messages.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";
import { immutableLifecycleCommandKey } from "../session/session-artifact-session/immutable-command-index.js";
import { immutableCheckpointKey } from "../session/session-artifact-session/immutable-checkpoint-index.js";
import { readMigrationMessageRecords } from "./immutable-session-migration-messages.js";
import { readMigrationOutboxPages } from "./immutable-session-migration-outbox.js";

async function seedMetadata(source, journal, scope, signal) {
  const transactions = new PartitionTransactions(journal);
  const input = {
    metadata: await source.readMetadata(),
    scopedMetadata: await source.readScopedMetadata(),
    dialogSequence: await source.readDialogSequence(),
  };
  signal?.throwIfAborted();
  const outcome = await transactions.commit(
    { epoch: journal.head.epoch, expectedGeneration: 0, operationId: randomUUID(), input },
    {
      validateScope: async (snapshot, view) => {
        const { collection, key } = PARTITION_SESSION_METADATA;
        const record = (await view.getLatestMany({ collection, keys: [key] })).get(key);
        assertPartitionInitializationScope(
          snapshot,
          record === null ? null : record.mutation.value,
          scope,
        );
      },
      prepare: (snapshot, view, captured) => {
        const seed = preparePartitionSessionImport(snapshot, view.generation, captured, scope);
        seed.mutations.push(...seedPartitionDisplayPublication());
        return seed;
      },
    },
  );
  if (outcome.status !== "committed")
    throw immutableStorageError("Migration metadata was not committed");
  return input.metadata.updatedAt;
}

function createImportWriter(journal, signal, submit) {
  const batchRecords = partitionTransactionSubmissionRecords(journal.head.limits);
  async function writeBatch(items) {
    signal?.throwIfAborted();
    const { epoch, sequence } = journal.head;
    const settled = await Promise.allSettled(
      items.map(async ({ input }, offset) =>
        submit({ epoch, expectedGeneration: sequence + offset, operationId: randomUUID(), input }),
      ),
    );
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "rejected") throw outcome.reason;
      if (outcome.value.status !== "committed")
        throw immutableStorageError(`Migration ${items[index].label} was not committed`);
    }
  }
  const write = (input) => writeBatch([{ input, label: "fact" }]);
  function buffered() {
    let pending = [];
    async function flush() {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      await writeBatch(batch);
    }
    async function add(input, label = "fact") {
      pending.push({ input, label });
      if (pending.length === batchRecords) await flush();
    }
    return { add, flush };
  }
  return { write, buffered, batchRecords };
}

function createFactWriter(journal, scope, signal) {
  const transactions = new PartitionSessionTransactions(journal, scope);
  return createImportWriter(journal, signal, ({ input: prepare, ...request }) =>
    transactions.commit({ ...request, input: null }, async (snapshot, view) => {
      const mutations = await prepare(view);
      await preparePartitionLifecycleIndex(view, mutations);
      const transitions = await readPartitionMessageTransitions(view, mutations);
      await preparePartitionDisplayTransaction({ snapshot, view, mutations, scope, transitions });
      return { action: "commit", mutations, result: null };
    }),
  );
}

async function prepareBindingImport(source, view, receipt) {
  const {
    commandId,
    result: { messageUid },
  } = receipt;
  const collection = PARTITION_MESSAGE_COLLECTIONS.messages;
  const entry = (await view.getLatestMany({ collection, keys: [messageUid] })).get(messageUid);
  if (
    entry === null ||
    entry.mutation.remove ||
    Object.hasOwn(entry.mutation.value, "attachmentBindingCommandId") ||
    !matchesAttachmentBindingReceipt(receipt, commandId, entry.mutation.value.message) ||
    (await source.readBindingCommandId(messageUid)) !== commandId
  )
    throw immutableStorageError(`Invalid source attachment binding ownership: ${commandId}`);
  return [
    {
      collection,
      key: messageUid,
      owner: entry.owner,
      value: { ...entry.mutation.value, attachmentBindingCommandId: commandId },
    },
    { collection: "commands", key: commandId, owner: null, value: receipt },
  ];
}

async function importLifecycle(source, { write, buffered }, signal) {
  const header = await source.readLifecycleHead();
  const outboxTail = await source.readOutboxTail();
  const writeHeader = (activeTurnScopeId) =>
    write(async (view) => {
      const { collection, key } = PARTITION_LIFECYCLE_HEADER;
      const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
      if (entry === null || entry.mutation.remove)
        throw immutableStorageError("Missing staging lifecycle header");
      return [
        {
          collection,
          key,
          owner: entry.owner,
          value: { ...header, activeTurnScopeId, outboxTail },
        },
      ];
    });
  if (header.sequence !== 0 || outboxTail !== 0) await writeHeader("");
  const { add, flush } = buffered();
  await source.visitCollection("commands", async (key, value) => {
    signal?.throwIfAborted();
    if (typeof value === "string") return;
    if (!isCanonicalCommandReceipt(value) || key !== immutableLifecycleCommandKey(value.commandId))
      throw immutableStorageError(`Invalid source command receipt: ${key}`);
    if (value.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND)
      await add((view) => prepareBindingImport(source, view, value));
    else await add(() => [{ collection: "commands", key: value.commandId, owner: null, value }]);
  });
  await flush();
  for (const collection of ["lifecycle", "timings", "replacements"]) {
    await source.visitCollection(collection, async (key, record) => {
      signal?.throwIfAborted();
      const value =
        collection === "replacements" ? createPartitionReplacementReference(record) : record;
      await add(() => [{ collection, key, owner: null, value }]);
    });
    await flush();
  }
  if (header.activeTurnScopeId !== "") await writeHeader(header.activeTurnScopeId);
  return outboxTail;
}

async function prepareEventImport(view, committed, delivery, retired) {
  const { eventId, ordinal, envelope } = committed;
  const mutations = [];
  const plan = createPartitionIndexMutations(view, mutations);
  if ((await plan.get("events", eventId)) !== null)
    throw immutableStorageError(`Duplicate source event: ${eventId}`);
  const { turnScopeId } = envelope.identity;
  const previous = await plan.get("turnOutbox", turnScopeId);
  const range = appendAuthorityOutboxTurnRange(previous, turnScopeId, ordinal);
  plan.set(
    "turnOutbox",
    turnScopeId,
    retired ? removeAuthorityOutboxTurnRange(range, turnScopeId, ordinal) : range,
  );
  const [event] = normalizeAuthorityEventOutbox([delivery === null ? committed : delivery]);
  plan.set("events", eventId, encodeStoredAuthorityOutboxEvent({ ...event, ordinal }));
  plan.set("eventOrder", authorityOutboxPositionKey(ordinal), eventId);
  if (!retired && delivery === null) plan.set(PARTITION_OUTBOX_DELIVERY_COMPACTIONS, eventId, true);
  await plan.apply();
  return mutations;
}

async function importOutbox(source, { write, buffered, batchRecords }, tail, signal) {
  const { add, flush } = buffered();
  const limit = Math.min(batchRecords, AUTHORITY_OUTBOX_PAGE_LIMIT);
  for await (const page of readMigrationOutboxPages(source, { limit, tail }, signal)) {
    for (const { committed, delivery, retired } of page.records) {
      signal?.throwIfAborted();
      await add((view) => prepareEventImport(view, committed, delivery, retired));
    }
  }
  await flush();
  const lifecycleKey = sessionLifecycleSequenceKey(source.scope.sessionId);
  await source.visitCollection("eventSequences", async (key, value) => {
    const floor = requireAuthorityEventSequenceFloor(value);
    if (key !== lifecycleKey)
      await write(() => [{ collection: "eventSequences", key, owner: null, value: floor }]);
  });
  await source.visitCollection("outboxConsumers", async (key) => {
    const cursor = await source.readOutboxCursor(key);
    if (cursor === null) throw immutableStorageError(`Missing source consumer cursor: ${key}`);
    await write(() => [
      { collection: "outboxConsumers", key, owner: null, value: { consumerId: key, cursor } },
    ]);
  });
}

async function importCheckpoints(source, { add, flush }, bounds, signal) {
  await source.visitCollection("checkpointHeads", async (turnScopeId, head) => {
    let cursor = null;
    let pending = null;
    let latest = null;
    const addReceipt = (receipt, previousRevision) =>
      add(() => [
        {
          collection: "checkpoints",
          key: immutableCheckpointKey(turnScopeId, receipt.checkpointId),
          owner: null,
          value: receipt,
        },
        {
          collection: "checkpointOrder",
          key: partitionCheckpointOrderKey(turnScopeId, receipt.checkpointRevision),
          owner: null,
          value: { checkpointId: receipt.checkpointId, previousRevision },
        },
      ]);
    do {
      signal?.throwIfAborted();
      const page = await source.readCheckpointPage({ ...bounds, turnScopeId, cursor });
      if (page === null)
        throw immutableStorageError(`Missing source checkpoint head: ${turnScopeId}`);
      for (const receipt of page.receipts) {
        if (pending === null) latest = receipt.checkpointRevision;
        else await addReceipt(pending, receipt.checkpointRevision);
        pending = receipt;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    if (pending !== null) await addReceipt(pending, null);
    await add(() => [
      { collection: "checkpointHeads", key: turnScopeId, owner: null, value: head },
      latest === null
        ? { collection: "turnCheckpoints", key: turnScopeId, owner: null, remove: true }
        : { collection: "turnCheckpoints", key: turnScopeId, owner: null, value: latest },
    ]);
  });
  await flush();
}

async function importArtifacts(source, { add, flush }, tail) {
  await source.visitCollection("metadata", async (key, value) => {
    if (!isArtifactRetirementKey(key)) return;
    const retirement = requireCommittedArtifactRetirement(value, tail);
    await add(() => [{ collection: "metadata", key, owner: null, value: retirement }]);
  });
  await source.visitCollection("pluginArtifacts", async (key, value) => {
    await add(() => [{ collection: "pluginArtifacts", key, owner: null, value }]);
  });
  await source.visitArtifactEvents(async ({ eventId }) => {
    await add(() => [
      { collection: PARTITION_SESSION_ARTIFACT_EVENTS, key: eventId, owner: null, value: true },
    ]);
  });
  await flush();
}

export async function importImmutableSessionBusinessState({
  source,
  journal,
  limit,
  maxBytes,
  signal,
}) {
  signal?.throwIfAborted();
  requirePageBounds({ after: 0, limit, maxBytes });
  if (journal.head.sequence !== 0 || journal.head.sessionId !== source.identity.sessionId)
    throw immutableStorageError("Migration requires an empty journal for the source session");
  const scope = source.scope;
  const committedAt = await seedMetadata(source, journal, scope, signal);
  const messages = new PartitionSessionMessages(journal, scope);
  const batch = createImportWriter(journal, signal, ({ input, ...request }) =>
    messages.importMessage({ ...request, ...input }),
  ).buffered();
  for await (const { ordinal, message } of readMigrationMessageRecords(
    source,
    { limit, maxBytes },
    signal,
  )) {
    signal?.throwIfAborted();
    const dialog = await source.readDialog(message.dialogProcessId);
    if (dialog === null)
      throw immutableStorageError(`Migration message has no source dialog at position ${ordinal}`);
    await batch.add(
      { committedAt, message, sourceDialog: dialog },
      `message at position ${ordinal}`,
    );
  }
  await batch.flush();
  const writer = createFactWriter(journal, scope, signal);
  const tail = await importLifecycle(source, writer, signal);
  await importOutbox(source, writer, tail, signal);
  await importArtifacts(source, writer.buffered(), tail);
  await importCheckpoints(source, writer.buffered(), { limit, maxBytes }, signal);
}
