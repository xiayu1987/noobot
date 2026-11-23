/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertSessionMessageEntity,
  assertSessionMessageMetadata,
  assertTurnRecord,
  projectTurnMessage,
} from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";

import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { IMMUTABLE_VALUE_READ_BATCH_RECORDS } from "@noobot/session-protocol/immutable-storage-graph";
import { matchesTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import {
  createMessageReadBudget,
  createScopedTurnMessagePage,
  requireFirstTurnMessageRead,
  requireMessagePage,
  requireMessageReadSelection,
  requireScopedTurnMessagePage,
  sessionMessagePageLength,
} from "@noobot/session-protocol/message-read-budget";

export function projectImmutableMessageRecord(record, lifecycle, metadata) {
  try {
    if (metadata) assertSessionMessageMetadata(metadata);
    else assertSessionMessageEntity(record.message);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable message entity", cause);
  }
  if (lifecycle !== null) {
    assertTurnRecord(lifecycle);
    if (
      lifecycle.turnScopeId !== record.message.turnScopeId ||
      lifecycle.dialogProcessId !== record.message.dialogProcessId
    )
      throw immutableStorageError("Message lifecycle ownership mismatch");
  }
  const message = projectTurnMessage(record.message, lifecycle);
  return message === record.message ? record : { ...record, message };
}

export async function readImmutableMessageMetadata({ store, snapshot, messageUid }) {
  const metadata = (
    await store.getManyMetadata(snapshot, "messages", [messageUid], {
      budget: createMessageReadBudget(),
    })
  ).get(messageUid);
  if (metadata === null) return null;
  const { value } = metadata;
  if (value?.message?.messageUid !== messageUid || value.message.sessionId !== store.sessionId)
    throw immutableStorageError("Immutable message ownership mismatch");
  const record = projectImmutableMessageRecord(
    value,
    await store.get(snapshot, "lifecycle", value.message.turnScopeId),
    metadata,
  );
  return { ...metadata, value: record };
}

export async function readImmutableMessage(store, snapshot, messageUid) {
  const [record] = await readImmutableMessages({ store, snapshot, messageUids: [messageUid] });
  return record;
}

export async function readImmutableMessages({ store, snapshot, messageUids, maxBytes }) {
  const budget = requireMessageReadSelection({ messageUids, maxBytes });
  return store.objects.withSnapshot(snapshot, async () => {
    const metadata = await store.getManyMetadata(snapshot, "messages", messageUids, { budget });
    const selected = [];
    const scopes = new Set();
    for (const uid of messageUids) {
      const entry = metadata.get(uid);
      if (entry === null) continue;
      const message = entry.value?.message;
      if (message?.messageUid !== uid || message.sessionId !== store.sessionId)
        throw immutableStorageError("Immutable message ownership mismatch");
      scopes.add(message.turnScopeId);
      selected.push(entry);
    }
    const lifecycles = await store.getMany(snapshot, "lifecycle", [...scopes]);
    for (const [index, entry] of selected.entries()) {
      const scope = entry.value.message.turnScopeId;
      const value = projectImmutableMessageRecord(entry.value, lifecycles.get(scope), entry);
      selected[index] = { ...entry, value };
    }
    const values = await store.objects.materializeValues(selected, { budget });
    const records = new Map(
      values.map((record) => [
        record.message.messageUid,
        projectImmutableMessageRecord(record, lifecycles.get(record.message.turnScopeId)),
      ]),
    );
    return messageUids.map((uid) => (metadata.get(uid) === null ? null : records.get(uid)));
  });
}

export async function readImmutableSessionMessages({
  store,
  snapshot,
  facts,
  turns,
  materializeMessages = (metadata) => store.objects.materializeValues(metadata),
}) {
  const order = new Map();
  for await (const [key, uid] of store.entries(snapshot, "messageOrder")) order.set(key, uid);
  if (order.size !== facts.messageSequence || facts.messageCount !== facts.messageSequence)
    throw immutableStorageError("Committed message count mismatch");
  const messages = [];
  let pending = [];
  async function flush() {
    const selected = await materializeMessages(pending);
    for (const record of selected) messages[record.ordinal - 1] = record.message;
    pending = [];
  }
  for await (const [uid, metadata] of store.entries(snapshot, "messages", { metadata: true })) {
    const record = metadata.value;
    if (
      record?.message?.messageUid !== uid ||
      record.message.sessionId !== store.sessionId ||
      !Number.isSafeInteger(record.ordinal) ||
      record.ordinal < 1 ||
      record.ordinal > facts.messageSequence ||
      order.get(immutableOrderKey(record.ordinal)) !== uid ||
      messages[record.ordinal - 1] !== undefined
    )
      throw immutableStorageError("Committed message order references an invalid message");
    const scope = record.message.turnScopeId;
    const turn = Object.hasOwn(turns, scope) ? turns[scope] : null;
    const projected = projectImmutableMessageRecord(record, turn, metadata);
    pending.push({ ...metadata, value: projected });
    messages[record.ordinal - 1] = projected.message;
    order.delete(immutableOrderKey(record.ordinal));
    if (pending.length === IMMUTABLE_VALUE_READ_BATCH_RECORDS) await flush();
  }
  if (pending.length) await flush();
  if (order.size || messages.length !== facts.messageCount)
    throw immutableStorageError("Committed message count mismatch");
  return messages;
}

async function readTurnDescriptor(store, snapshot, turnScopeId) {
  const turn = await store.get(snapshot, "turns", turnScopeId);
  if (turn === null) return null;
  if (
    turn.turnScopeId !== turnScopeId ||
    !Number.isSafeInteger(turn.messageSequence) ||
    turn.messageSequence < 0
  )
    throw immutableStorageError("Invalid immutable turn descriptor");
  return turn;
}

async function readTurnPositionMetadata({ store, turn, ordinals, budget }) {
  const keys = ordinals.map(immutableOrderKey);
  const positions = await store.index.getMany(turn.messageOrderRoot, keys);
  const orderReferences = keys.map((key) => positions.get(key));
  if (orderReferences.some((reference) => reference === null))
    throw immutableStorageError("Turn order is missing a committed position");
  const messageUids = await store.objects.readValues(orderReferences, { budget });
  const references = await store.index.getMany(turn.messagesRoot, messageUids);
  const messageReferences = messageUids.map((uid) => references.get(uid));
  if (messageReferences.some((reference) => reference === null))
    throw immutableStorageError("Turn order references a missing message");
  const metadata = await store.objects.readValuesMetadata(messageReferences, { budget });
  for (let position = 0; position < metadata.length; position += 1) {
    const record = metadata[position].value;
    if (
      record?.message?.messageUid !== messageUids[position] ||
      record.message.sessionId !== store.sessionId ||
      record.message.turnScopeId !== turn.turnScopeId ||
      record.message.dialogProcessId !== turn.dialogProcessId ||
      record.turnOrdinal !== ordinals[position]
    )
      throw immutableStorageError("Turn message index ownership mismatch");
  }
  return metadata;
}

export async function readImmutableFirstTurnMessage({ store, snapshot, turnScopeId, maxBytes }) {
  const budget = requireFirstTurnMessageRead({ turnScopeId, maxBytes });
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null || turn.messageSequence === 0) return null;
    const [record] = await readTurnWindow({
      store,
      turn,
      lifecycle: await store.get(snapshot, "lifecycle", turnScopeId),
      after: 0,
      length: 1,
      budget,
    });
    return record.message;
  });
}

export async function readImmutableTurnAnchorMetadata({
  store,
  snapshot,
  turnScopeId,
  budget = createMessageReadBudget(),
}) {
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null) return null;
    if (turn.messageSequence === 0)
      throw immutableStorageError("Message range anchor has no committed position");
    const [metadata] = await readTurnPositionMetadata({ store, turn, ordinals: [1], budget });
    const value = projectImmutableMessageRecord(
      metadata.value,
      await store.get(snapshot, "lifecycle", turnScopeId),
      metadata,
    );
    return { ...metadata, value };
  });
}

export async function readImmutableTurnPage({
  store,
  snapshot,
  turnScopeId,
  after = 0,
  limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
  maxBytes,
}) {
  const budget = requireMessagePage({ turnScopeId, after, limit, maxBytes });
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null) return null;
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    const length = Math.min(limit, Math.max(0, turn.messageSequence - after));
    const records = await readTurnWindow({
      store,
      turn,
      lifecycle,
      after,
      length,
      budget,
    });
    const end = after + records.length;
    return {
      generation: snapshot.generation,
      records,
      cursor: end,
      hasMore: end < turn.messageSequence,
    };
  });
}

async function readTurnWindow({ store, turn, lifecycle, after, length, budget, selectPart }) {
  if (length === 0) return [];
  const ordinals = [];
  for (let ordinal = after + 1; ordinal <= after + length; ordinal += 1) ordinals.push(ordinal);
  const metadata = await readTurnPositionMetadata({ store, turn, ordinals, budget });
  if (selectPart) {
    const selected = metadata.map((entry) => {
      const value = projectImmutableMessageRecord(entry.value, lifecycle, entry);
      return { value, parts: entry.parts.filter((part) => selectPart(value.message, part.path)) };
    });
    return store.objects.materializeValues(selected, { budget });
  }
  const values = await store.objects.materializeValues(metadata, { budget });
  return values.map((value) => projectImmutableMessageRecord(value, lifecycle));
}

export function readImmutableScopedTurnMessagePage(options) {
  return readImmutableScopedTurnPage(options, requireScopedTurnMessagePage);
}

export async function readImmutableScopedTurnPage(
  { store, snapshot, lookupKey, cursor, limit, maxBytes },
  requirePage,
  selectPart,
) {
  const { key, position, budget } = requirePage(
    [store.sessionId, snapshot.format, snapshot.commit],
    { lookupKey, cursor, limit, maxBytes },
  );
  const { turnScopeId } = key;
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null || !matchesTurnLookupKey(turn, key)) {
      sessionMessagePageLength(position.after, 0, limit);
      return null;
    }
    const messageCount = turn.messageSequence;
    const length = sessionMessagePageLength(position.after, messageCount, limit);
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    const records = await readTurnWindow({
      store,
      turn,
      lifecycle,
      after: position.after,
      length,
      budget,
      selectPart,
    });
    return createScopedTurnMessagePage({
      generation: snapshot.generation,
      messageCount,
      records,
      position,
    });
  });
}
