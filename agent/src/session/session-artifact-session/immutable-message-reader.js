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

function requirePage(after, limit) {
  const pageLimit = QUANTITY_THRESHOLDS.immutableStorage.messagePageSize;
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > pageLimit
  )
    throw new TypeError(
      `Immutable message page requires a non-negative cursor and limit 1..${pageLimit}`,
    );
}

function projectMessage(record, lifecycle, metadata) {
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

export async function readImmutableMessage(store, snapshot, messageUid) {
  const record = await store.get(snapshot, "messages", messageUid);
  if (record === null) return null;
  if (record?.message?.messageUid !== messageUid || record.message.sessionId !== store.sessionId)
    throw immutableStorageError("Immutable message ownership mismatch");
  return projectMessage(record, await store.get(snapshot, "lifecycle", record.message.turnScopeId));
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
    const projected = projectMessage(record, turn, metadata);
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

async function readTurnPositions({ store, turn, ordinals }) {
  const keys = ordinals.map(immutableOrderKey);
  const positions = await store.index.getMany(turn.messageOrderRoot, keys);
  const orderReferences = keys.map((key) => positions.get(key));
  if (orderReferences.some((reference) => reference === null))
    throw immutableStorageError("Turn order is missing a committed position");
  const messageUids = await store.objects.readValues(orderReferences);
  const references = await store.index.getMany(turn.messagesRoot, messageUids);
  const messageReferences = messageUids.map((uid) => references.get(uid));
  if (messageReferences.some((reference) => reference === null))
    throw immutableStorageError("Turn order references a missing message");
  const records = await store.objects.readValues(messageReferences);
  for (let position = 0; position < records.length; position += 1) {
    const record = records[position];
    if (
      record?.message?.messageUid !== messageUids[position] ||
      record.message.sessionId !== store.sessionId ||
      record.message.turnScopeId !== turn.turnScopeId ||
      record.message.dialogProcessId !== turn.dialogProcessId ||
      record.turnOrdinal !== ordinals[position]
    )
      throw immutableStorageError("Turn message index ownership mismatch");
  }
  return records;
}

export async function readImmutableTurnAnchor({ store, snapshot, turnScopeId }) {
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null) return null;
    if (turn.messageSequence === 0)
      throw immutableStorageError("Message range anchor has no committed position");
    const [record] = await readTurnPositions({ store, turn, ordinals: [1] });
    return projectMessage(record, await store.get(snapshot, "lifecycle", turnScopeId));
  });
}

export async function readImmutableTurnPage({
  store,
  snapshot,
  turnScopeId,
  after = 0,
  limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
}) {
  requirePage(after, limit);
  return store.objects.withSnapshot(snapshot, async () => {
    const turn = await readTurnDescriptor(store, snapshot, turnScopeId);
    if (turn === null) return null;
    const lifecycle = await store.get(snapshot, "lifecycle", turnScopeId);
    const end =
      after >= turn.messageSequence ? after : Math.min(turn.messageSequence, after + limit);
    const ordinals = [];
    for (let ordinal = after + 1; ordinal <= end; ordinal += 1) ordinals.push(ordinal);
    const values = await readTurnPositions({ store, turn, ordinals });
    const records = values.map((value) => projectMessage(value, lifecycle));
    return {
      generation: snapshot.generation,
      records,
      cursor: end,
      hasMore: end < turn.messageSequence,
    };
  });
}
