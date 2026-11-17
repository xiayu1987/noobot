/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  acknowledgeAuthorityEventDelivery,
  authorityEventConsumerDelivery,
  recordAuthorityEventDeliveryAttempt,
  compactAuthorityEventOutbox,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  requireImmutableOutboxIndex,
  removeImmutableOutboxEvent,
} from "./immutable-outbox-turn-index.js";
export { prepareImmutableOutboxTurnRemoval } from "./immutable-outbox-turn-index.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

function requireConsumer(consumerId) {
  if (
    typeof consumerId !== "string" ||
    !consumerId ||
    consumerId.trim() !== consumerId ||
    Buffer.byteLength(consumerId) > 1024
  )
    throw new TypeError("Outbox page requires a canonical consumerId");
}

export async function prepareImmutableOutboxMaintenance(
  store,
  plan,
  { retainDeliveredAfter },
  sessionId,
) {
  if (
    typeof retainDeliveredAfter !== "string" ||
    !Number.isFinite(Date.parse(retainDeliveredAfter))
  )
    throw new TypeError("Outbox maintenance requires a retention timestamp");
  const header = await requireImmutableOutboxIndex(plan);
  const previous = await plan.get("metadata", "outboxMaintenance");
  const after = previous?.cursor ?? 0;
  if (
    !header ||
    !Number.isSafeInteger(header.sequence) ||
    header.sequence < 0 ||
    !Number.isSafeInteger(after) ||
    after < 0 ||
    after > header.sequence
  )
    throw immutableStorageError("Invalid immutable outbox maintenance cursor");
  const end = Math.min(
    header.sequence,
    after + QUANTITY_THRESHOLDS.immutableStorage.receiptPageSize,
  );
  let removed = 0;
  let nextRetainedDeliveryAt = null;
  for (let ordinal = after + 1; ordinal <= end; ordinal += 1) {
    const item = await readOutboxPosition(
      (collection, key) => plan.get(collection, key),
      ordinal,
      sessionId,
    );
    if (item === null) continue;
    const result = compactAuthorityEventOutbox([item], { retainDeliveredAfter });
    if (
      result.nextRetainedDeliveryAt !== null &&
      (nextRetainedDeliveryAt === null || result.nextRetainedDeliveryAt < nextRetainedDeliveryAt)
    )
      nextRetainedDeliveryAt = result.nextRetainedDeliveryAt;
    if (result.removed) {
      await removeImmutableOutboxEvent(store, plan, item);
      removed += 1;
    }
  }
  const hasMore = end < header.sequence;
  plan.set("metadata", "outboxMaintenance", { cursor: hasMore ? end : 0 });
  return { compacted: removed > 0, removed, scanned: end - after, hasMore, nextRetainedDeliveryAt };
}

async function readCursor(get, consumerId) {
  const state = await get("outboxConsumers", consumerId);
  if (state === null) return 0;
  if (state.consumerId !== consumerId || !Number.isSafeInteger(state.cursor) || state.cursor < 0)
    throw immutableStorageError("Invalid immutable outbox consumer cursor");
  return state.cursor;
}

async function readOutboxPosition(get, ordinal, sessionId) {
  const eventId = await get("eventOrder", immutableOrderKey(ordinal));
  if (eventId === null) throw immutableStorageError("Event order has a missing position");
  return readOutboxEvent(get, eventId, sessionId);
}

async function readOutboxEvent(get, eventId, sessionId) {
  const item = await get("outbox", eventId);
  return requireOutboxEvent(item, eventId, sessionId);
}

function requireOutboxEvent(item, eventId, sessionId) {
  if (item === null) return null;
  try {
    normalizeAuthorityEventOutbox([item]);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable outbox event", cause);
  }
  if (item.eventId !== eventId || item.envelope.identity.sessionId !== sessionId)
    throw immutableStorageError("Outbox event index ownership mismatch");
  return item;
}

export function readImmutableOutboxEvent(store, snapshot, eventId) {
  return readOutboxEvent(
    (collection, key) => store.get(snapshot, collection, key),
    eventId,
    store.sessionId,
  );
}

async function assertDeliveredRange(plan, { previous, cursor, sessionId, consumerId }) {
  const items = await readOutboxRange(
    (collection, keys) => plan.getMany(collection, keys),
    previous,
    cursor,
    sessionId,
  );
  for (const item of items) {
    if (item !== null && !authorityEventConsumerDelivery(item, consumerId).deliveredAt)
      throw Object.assign(new Error("Outbox cursor cannot skip an undelivered event"), {
        code: "SESSION_OUTBOX_CURSOR_UNDELIVERED",
        eventId: item.eventId,
      });
  }
}

export async function prepareImmutableOutboxCursors(plan, updates, sessionId) {
  const results = [];
  for (const update of updates) {
    requireConsumer(update?.consumerId);
    const { consumerId, expectedCursor, cursor } = update;
    if (
      !Number.isSafeInteger(expectedCursor) ||
      expectedCursor < 0 ||
      !Number.isSafeInteger(cursor) ||
      cursor < expectedCursor ||
      cursor - expectedCursor > 256
    )
      throw new TypeError("Outbox cursor advance requires a bounded monotonic range");
    const previous = await readCursor((collection, key) => plan.get(collection, key), consumerId);
    if (previous !== expectedCursor)
      throw Object.assign(new Error("Outbox consumer cursor conflict"), {
        code: "SESSION_OUTBOX_CURSOR_CONFLICT",
        currentCursor: previous,
      });
    const header = await plan.get("metadata", "events");
    if (!header || !Number.isSafeInteger(header.sequence) || header.sequence < previous)
      throw immutableStorageError("Invalid immutable event ordinal");
    if (cursor > header.sequence)
      throw new TypeError("Outbox cursor exceeds the committed event sequence");
    await assertDeliveredRange(plan, { previous, cursor, sessionId, consumerId });
    if (cursor !== previous) plan.set("outboxConsumers", consumerId, { consumerId, cursor });
    results.push({ consumerId, cursor });
  }
  return results;
}

export async function prepareImmutableDeliveries(plan, updates, sessionId) {
  const results = [];
  for (const update of updates) {
    if (update?.type !== "attempt" && update?.type !== "acknowledge")
      throw new TypeError("Unknown immutable outbox delivery update");
  }
  const current = await plan.getMany(
    "outbox",
    updates.map((update) => update.eventId),
  );
  for (const update of updates) {
    const previous = requireOutboxEvent(current.get(update.eventId), update.eventId, sessionId);
    if (!previous)
      throw Object.assign(new Error("Authority outbox event is missing"), {
        code: "SESSION_OUTBOX_EVENT_MISSING",
      });
    const result =
      update.type === "attempt"
        ? recordAuthorityEventDeliveryAttempt([previous], update)
        : acknowledgeAuthorityEventDelivery([previous], update);
    const next = { ...previous, ...result.outbox[0] };
    current.set(update.eventId, next);
    if (JSON.stringify(next) !== JSON.stringify(previous)) plan.set("outbox", update.eventId, next);
    results.push({
      eventId: update.eventId,
      delivery: authorityEventConsumerDelivery(next, update.consumerId),
    });
  }
  return results;
}

async function readOutboxRange(getMany, after, end, sessionId) {
  const positions = Array.from({ length: end - after }, (...[, index]) =>
    immutableOrderKey(after + index + 1),
  );
  const orderedIds = await getMany("eventOrder", positions);
  const ids = positions.map((position) => {
    const eventId = orderedIds.get(position);
    if (eventId === null) throw immutableStorageError("Event order has a missing position");
    return eventId;
  });
  const items = await getMany("outbox", ids);
  return ids.map((eventId) => requireOutboxEvent(items.get(eventId), eventId, sessionId));
}

export async function readImmutableOutboxPage({
  store,
  snapshot,
  consumerId,
  after,
  limit = QUANTITY_THRESHOLDS.immutableStorage.receiptPageSize,
}) {
  requireConsumer(consumerId);
  const get = (collection, key) => store.get(snapshot, collection, key);
  if (after === undefined) after = await readCursor(get, consumerId);
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 256
  )
    throw new TypeError("Outbox page requires a non-negative cursor and limit 1..256");
  const header = await store.get(snapshot, "metadata", "events");
  if (!header || !Number.isSafeInteger(header.sequence) || header.sequence < 0)
    throw immutableStorageError("Invalid immutable event ordinal");
  if (after > header.sequence)
    throw new TypeError("Outbox cursor exceeds the committed event sequence");
  const end = after >= header.sequence ? after : Math.min(header.sequence, after + limit);
  const events = [];
  const items = await readOutboxRange(
    (collection, keys) => store.getMany(snapshot, collection, keys),
    after,
    end,
    store.sessionId,
  );
  for (const [index, item] of items.entries()) {
    if (item === null) continue;
    if (!authorityEventConsumerDelivery(item, consumerId).deliveredAt)
      events.push({ ...item, ordinal: after + index + 1 });
  }
  return {
    generation: snapshot.generation,
    events,
    after,
    cursor: end,
    hasMore: end < header.sequence,
  };
}
