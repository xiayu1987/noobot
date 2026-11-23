/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import {
  AUTHORITY_OUTBOX_PAGE_LIMIT,
  authorityOutboxPositionKey,
  authorityOutboxSequenceKey,
  normalizeAuthorityEventOutbox,
  requireAuthorityEventSequenceFloor,
} from "@noobot/event-protocol/outbox";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import {
  readPartitionLifecycleHeader,
  readPartitionStoredEventSequenceFloor,
} from "@noobot/session-protocol/partition-session-state";
import { sessionLifecycleSequenceKey } from "@noobot/session-protocol/turn-lifecycle";
import {
  readPartitionCommittedOutboxPage,
  readPartitionOutboxCursor,
  readPartitionOutboxEvent,
  readPartitionOutboxTail,
} from "../session/partition-storage/partition-outbox.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";
import { immutableOrderKey } from "../session/session-artifact-session/immutable-order-key.js";
import { readMigrationOutboxPages } from "./immutable-session-migration-outbox.js";

function requireSourceFloor(value) {
  try {
    return requireAuthorityEventSequenceFloor(value);
  } catch (cause) {
    throw Object.assign(immutableStorageError(cause.message), { cause });
  }
}

async function verifySequenceFloors(context, lifecycleKey, lastLifecycleEvent) {
  const { source, session, snapshot, signal, collections } = context;
  const { sequence } = await source.readLifecycleHead();
  if ((await source.readStoredEventSequenceFloor(lifecycleKey)) !== lastLifecycleEvent)
    throw immutableStorageError(
      "Source lifecycle event sequence floor disagrees with committed events",
    );
  if (lastLifecycleEvent !== null && lastLifecycleEvent > sequence)
    throw immutableStorageError("Source committed lifecycle event exceeds its lifecycle head");
  const targetHead = await session.read(snapshot, readPartitionLifecycleHeader);
  if (targetHead.sequence !== sequence)
    throw immutableStorageError("Staged lifecycle event sequence floor differs from source");
  const targetFloor = (key) =>
    session.read(snapshot, (read) => readPartitionStoredEventSequenceFloor(read, key));
  await source.visitCollection("eventSequences", async (key, value) => {
    signal?.throwIfAborted();
    if (key !== lifecycleKey && requireSourceFloor(value) !== (await targetFloor(key)))
      throw immutableStorageError(`Staged event sequence floor differs from source: ${key}`);
  });
  await collections.visitCollectionKeys(snapshot, ["eventSequences"], async (key) => {
    signal?.throwIfAborted();
    if ((await targetFloor(key)) === null) return;
    if (key === lifecycleKey)
      throw immutableStorageError("Staged lifecycle event sequence floor duplicates its head");
    if ((await source.readStoredEventSequenceFloor(key)) === null)
      throw immutableStorageError(`Staged session has an extra event sequence floor: ${key}`);
  });
}

function isCommittedPosition(key, tail, encode) {
  const ordinal = Number(key);
  return Number.isSafeInteger(ordinal) && ordinal > 0 && ordinal <= tail && encode(ordinal) === key;
}

async function verifyPositionIndex({ source, collections, snapshot, signal }, tail) {
  await source.visitCollection("eventOrder", (key) => {
    signal?.throwIfAborted();
    if (!isCommittedPosition(key, tail, immutableOrderKey))
      throw immutableStorageError(`Source event position is outside the committed index: ${key}`);
  });
  await collections.visitCollectionKeys(snapshot, ["eventOrder"], async (key, collection) => {
    signal?.throwIfAborted();
    if (isCommittedPosition(key, tail, authorityOutboxPositionKey)) return;
    const entries = await collections.getLatestMany({ snapshot, collection, keys: [key] });
    if (entries.get(key) !== null)
      throw immutableStorageError(`Staged event position is outside the committed index: ${key}`);
  });
}

async function verifyCommittedSequenceFloor(source, key, sequence, ordinal) {
  const floor = requireSourceFloor(await source.readStoredEventSequenceFloor(key));
  if (sequence > floor)
    throw immutableStorageError(`Committed event exceeds its sequence floor: ${ordinal}`);
}

function verifyCommittedEvent(expected, actual) {
  const { ordinal } = expected;
  if (
    expected.eventId !== actual.eventId ||
    expected.committedAt !== actual.committedAt ||
    !isDeepStrictEqual(expected.envelope, actual.envelope)
  )
    throw immutableStorageError(`Staged committed event differs at outbox position: ${ordinal}`);
}

async function* readTargetCommittedWindows(context, { records, cursor: end }) {
  const { session, scope, snapshot, signal } = context;
  const start = end - records.length;
  let after = start;
  while (after < end) {
    signal?.throwIfAborted();
    const window = await session.read(snapshot, (read) =>
      readPartitionCommittedOutboxPage(read, scope, snapshot, {
        after,
        limit: end - after,
        tail: end,
      }),
    );
    for (const target of window.records) {
      signal?.throwIfAborted();
      const { committed } = records[target.ordinal - start - 1];
      verifyCommittedEvent(committed, target);
      yield committed;
    }
    after = window.cursor;
  }
}

async function verifyCommittedPage(context, page, lifecycleKey, lastLifecycleEvent) {
  for await (const {
    ordinal,
    envelope: { ordering },
  } of readTargetCommittedWindows(context, page)) {
    const { domain, scopeId, sequence } = ordering;
    const key = authorityOutboxSequenceKey(domain, scopeId);
    if (key !== lifecycleKey) {
      await verifyCommittedSequenceFloor(context.source, key, sequence, ordinal);
      continue;
    }
    if (lastLifecycleEvent !== null && sequence <= lastLifecycleEvent)
      throw immutableStorageError(`Committed lifecycle event sequence did not advance: ${ordinal}`);
    lastLifecycleEvent = sequence;
  }
  return lastLifecycleEvent;
}

async function verifyCommittedPositions(context, lifecycleKey) {
  const { source, session, scope, snapshot, signal } = context;
  const tail = await source.readOutboxTail();
  const targetTail = await session.read(snapshot, (read) =>
    readPartitionOutboxTail(read, scope, snapshot),
  );
  if (tail !== targetTail)
    throw immutableStorageError(`Staged outbox tail differs from source: ${targetTail} != ${tail}`);
  let lastLifecycleEvent = null;
  const limit = Math.min(AUTHORITY_OUTBOX_PAGE_LIMIT, snapshot.limits.pageRecords);
  for await (const page of readMigrationOutboxPages(source, { limit, tail }, signal)) {
    lastLifecycleEvent = await verifyCommittedPage(context, page, lifecycleKey, lastLifecycleEvent);
  }
  await verifyPositionIndex(context, tail);
  return lastLifecycleEvent;
}

export async function verifyImmutableSessionOutbox({ source, journal, scope, snapshot, signal }) {
  const collections = new PartitionTransactions(journal);
  const session = new PartitionSessionTransactions(journal, scope);
  const readTarget = (eventId) =>
    session.read(snapshot, (read) => readPartitionOutboxEvent(read, scope, snapshot, eventId));
  await source.visitCollection("outbox", async (eventId) => {
    signal?.throwIfAborted();
    const expected = await source.readOutboxEvent(eventId);
    const actual = await readTarget(eventId);
    if (
      expected === null ||
      actual === null ||
      !isDeepStrictEqual(
        normalizeAuthorityEventOutbox([actual]),
        normalizeAuthorityEventOutbox([expected]),
      )
    )
      throw immutableStorageError(`Staged outbox event differs from source: ${eventId}`);
    if (actual.ordinal !== expected.ordinal)
      throw immutableStorageError(`Staged outbox event position differs from source: ${eventId}`);
  });
  const pinned = { source, session, scope, snapshot, signal, collections };
  const lifecycleKey = sessionLifecycleSequenceKey(scope.sessionId);
  const lastLifecycleEvent = await verifyCommittedPositions(pinned, lifecycleKey);
  await collections.visitCollectionKeys(snapshot, ["events"], async (eventId) => {
    signal?.throwIfAborted();
    if ((await source.readOutboxEvent(eventId)) === null && (await readTarget(eventId)) !== null)
      throw immutableStorageError(`Staged session has an extra outbox event: ${eventId}`);
  });
  const readTargetCursor = (consumerId) =>
    session.read(snapshot, (read) => readPartitionOutboxCursor(read, scope, snapshot, consumerId));
  await source.visitCollection("outboxConsumers", async (consumerId) => {
    signal?.throwIfAborted();
    if ((await source.readOutboxCursor(consumerId)) !== (await readTargetCursor(consumerId)))
      throw immutableStorageError(`Staged outbox cursor differs from source: ${consumerId}`);
  });
  await collections.visitCollectionKeys(snapshot, ["outboxConsumers"], async (consumerId) => {
    signal?.throwIfAborted();
    if (
      (await source.readOutboxCursor(consumerId)) === null &&
      (await readTargetCursor(consumerId)) !== null
    )
      throw immutableStorageError(`Staged session has an extra outbox cursor: ${consumerId}`);
  });
  await verifySequenceFloors(pinned, lifecycleKey, lastLifecycleEvent);
}
