/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  readImmutableMessageMetadata,
  readImmutableTurnAnchorMetadata,
  projectImmutableMessageRecord,
} from "./immutable-message-reader.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { resolveSessionMessageSuffix } from "@noobot/session-protocol";
import { readImmutableIndexedTitle } from "./immutable-title-index.js";
import {
  createSessionMessagePageRecord,
  nextSessionMessagePageCursor,
  requireMessagePage,
  requirePageBounds,
  requireSessionMessagePageDirection,
  requireSessionMessagePagePosition,
  sessionMessagePageLength,
  sessionMessagePageWindow,
} from "@noobot/session-protocol/message-read-budget";

async function readMessageCount(store, snapshot) {
  const facts = await store.get(snapshot, "metadata", "facts");
  if (
    !facts ||
    !Number.isSafeInteger(facts.messageCount) ||
    facts.messageCount < 0 ||
    facts.messageCount !== facts.messageSequence
  )
    throw immutableStorageError("Invalid message range sequence or count");
  return facts.messageCount;
}

async function readRangeAnchor({ store, snapshot, turnScopeId, budget }) {
  const metadata = await readImmutableTurnAnchorMetadata({ store, snapshot, turnScopeId, budget });
  if (metadata === null) return null;
  const first = metadata.value;
  const suffix = resolveSessionMessageSuffix(
    first.ordinal,
    await readMessageCount(store, snapshot),
  );
  if (suffix === null) throw immutableStorageError("Invalid message range anchor ordinal");
  return { first, suffix };
}

export async function readImmutableMessageTailPage({
  store,
  snapshot,
  turnScopeId,
  cursor = null,
  limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
  maxBytes,
}) {
  const position = requireSessionMessagePagePosition(
    [store.sessionId, snapshot.format, snapshot.commit, "suffix", turnScopeId],
    cursor,
  );
  const budget = requireMessagePage({ turnScopeId, after: position.after, limit, maxBytes });
  return store.objects.withSnapshot(snapshot, () =>
    readMessageTailPage({ store, snapshot, turnScopeId, position, limit, budget }),
  );
}

export async function readImmutableSessionAutoTitle(store, snapshot) {
  return store.objects.withSnapshot(snapshot, () =>
    readImmutableIndexedTitle(store, {
      get: (collection, key) => store.get(snapshot, collection, key),
      getMetadata: (_collection, messageUid) =>
        readImmutableMessageMetadata({ store, snapshot, messageUid }),
    }),
  );
}

export function readImmutableMessagePage(options) {
  return readGlobalMessagePage(options, "global", materializeMessageWindow);
}

export function readImmutableMessageDisplaySourcePage(options, materializeDisplaySources) {
  return readGlobalMessagePage(options, "display-source", materializeDisplaySources);
}

async function readGlobalMessagePage(
  {
    store,
    snapshot,
    cursor = null,
    limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
    maxBytes,
    direction = "forward",
  },
  query,
  materialize,
) {
  requireSessionMessagePageDirection(direction);
  const position = requireSessionMessagePagePosition(
    [store.sessionId, snapshot.format, snapshot.commit, query, direction],
    cursor,
  );
  const budget = requirePageBounds({ after: position.after, limit, maxBytes });
  return store.objects.withSnapshot(snapshot, async () => {
    const messageCount = await readMessageCount(store, snapshot);
    const window = sessionMessagePageWindow({
      after: position.after,
      count: messageCount,
      limit,
      direction,
    });
    const records = await materialize(
      await readMessageWindow({
        store,
        snapshot,
        start: window.after,
        length: window.length,
        budget,
      }),
      store,
      budget,
    );
    return {
      generation: snapshot.generation,
      messageCount,
      records,
      nextCursor: nextSessionMessagePageCursor(
        position,
        records.length,
        position.after + records.length < messageCount,
      ),
    };
  });
}

async function readMessageTailPage({ store, snapshot, turnScopeId, position, limit, budget }) {
  const anchor = await readRangeAnchor({ store, snapshot, turnScopeId, budget });
  if (anchor === null) return null;
  const { first, suffix } = anchor;
  const { messageSuffix, deletedCount, retainedMessageCount } = suffix;
  const length = sessionMessagePageLength(position.after, deletedCount, limit);
  const start = retainedMessageCount + position.after;
  const window = await readMessageWindow({ store, snapshot, start, length, budget, first });
  const records = await materializeMessageWindow(window, store, budget);
  return {
    generation: snapshot.generation,
    messageSuffix,
    records,
    nextCursor: nextSessionMessagePageCursor(
      position,
      records.length,
      position.after + records.length < deletedCount,
    ),
  };
}

async function readMessageWindow({ store, snapshot, start, length, budget, first }) {
  if (length === 0) return { selected: [], lifecycles: new Map() };
  const keys = [];
  for (let ordinal = start + 1; ordinal <= start + length; ordinal += 1)
    keys.push(immutableOrderKey(ordinal));
  const anchorKey = first ? immutableOrderKey(first.ordinal) : null;
  const order = await store.getMany(
    snapshot,
    "messageOrder",
    anchorKey !== null && keys[0] !== anchorKey ? [anchorKey, ...keys] : keys,
  );
  if (first && order.get(anchorKey) !== first.message.messageUid)
    throw immutableStorageError("Message range anchor disagrees with global order");
  const messageUids = keys.map((key) => {
    const messageUid = order.get(key);
    if (typeof messageUid !== "string" || !messageUid)
      throw immutableStorageError("Message range has a missing committed position");
    return messageUid;
  });
  const metadata = await store.getManyMetadata(snapshot, "messages", messageUids, { budget });
  const selected = messageUids.map((messageUid, i) => {
    const entry = metadata.get(messageUid);
    const record = entry?.value;
    const ordinal = start + i + 1;
    if (!record || record.ordinal !== ordinal)
      throw immutableStorageError("Message range position references an invalid message");
    if (record.message?.messageUid !== messageUid || record.message.sessionId !== store.sessionId)
      throw immutableStorageError("Immutable message ownership mismatch");
    return entry;
  });
  const scopes = [...new Set(selected.map(({ value }) => value.message.turnScopeId))];
  const lifecycles = await store.getMany(snapshot, "lifecycle", scopes);
  return { selected, lifecycles };
}

async function materializeMessageWindow({ selected, lifecycles }, store, budget) {
  const values = await store.objects.materializeValues(selected, { budget });
  return values.map((value) =>
    createSessionMessagePageRecord(
      projectImmutableMessageRecord(value, lifecycles.get(value.message.turnScopeId)),
    ),
  );
}
