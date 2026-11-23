/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import {
  artifactRetirementKey,
  isCommittedArtifactRetired,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  AUTHORITY_OUTBOX_PAGE_LIMIT,
  acknowledgeAuthorityEventDelivery,
  assertAuthorityEventScope,
  authorityEventConsumerDelivery,
  authorityOutboxCommittedPageWindow,
  recordAuthorityEventDeliveryAttempt,
  compactAuthorityEventOutbox,
  decodeStoredAuthorityOutboxCursor,
  normalizeAuthorityEventOutbox,
  requireAuthorityOutboxConsumer,
  requireAuthorityOutboxCursorAdvances,
  requireAuthorityOutboxPagePosition,
} from "@noobot/event-protocol/outbox";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  requireImmutableOutboxIndex,
  removeImmutableOutboxEvent,
} from "./immutable-outbox-turn-index.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

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

async function readCursor(get, consumerId, tail) {
  const state = await get("outboxConsumers", consumerId);
  try {
    return decodeStoredAuthorityOutboxCursor(state, consumerId, tail);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable outbox consumer cursor", cause);
  }
}

export async function readImmutableOutboxCursor(store, snapshot, consumerId) {
  const get = (collection, key) => store.get(snapshot, collection, key);
  return readCursor(get, consumerId, await readOutboxTail(get));
}

export async function readOutboxTail(get) {
  const header = await get("metadata", "events");
  if (!Number.isSafeInteger(header?.sequence) || header.sequence < 0)
    throw immutableStorageError("Invalid immutable event ordinal");
  return header.sequence;
}

export function readImmutableOutboxTail(store, snapshot) {
  return readOutboxTail((collection, key) => store.get(snapshot, collection, key));
}

function requireEventIdAtPosition(eventId, ordinal) {
  if (typeof eventId !== "string" || !eventId)
    throw immutableStorageError(`Event order has a missing or invalid position: ${ordinal}`);
  return eventId;
}

async function readEventIdAtPosition(get, ordinal) {
  return requireEventIdAtPosition(await get("eventOrder", immutableOrderKey(ordinal)), ordinal);
}

async function readOutboxPosition(get, ordinal, sessionId) {
  return readOutboxEvent(get, await readEventIdAtPosition(get, ordinal), sessionId);
}

function requireCommittedEvent(value, eventId, scope, ordinal) {
  const event = requireOutboxEvent(value, eventId, scope.sessionId);
  if (event?.ordinal !== ordinal)
    throw immutableStorageError(`Missing or mismatched immutable committed event at ${ordinal}`);
  try {
    assertAuthorityEventScope(event, scope);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable committed event scope", cause);
  }
  return event;
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

function bindOutboxDelivery(event, committed) {
  if (event === null) return null;
  if (
    committed === null ||
    (Object.hasOwn(event, "ordinal") && event.ordinal !== committed.ordinal) ||
    event.committedAt !== committed.committedAt ||
    !isDeepStrictEqual(event.envelope, committed.envelope)
  )
    throw immutableStorageError("Immutable outbox delivery does not match its committed event");
  return { ...event, ordinal: committed.ordinal };
}

export async function readImmutableOutboxEvent(store, snapshot, eventId) {
  const get = (collection, key) => store.get(snapshot, collection, key);
  const event = await readOutboxEvent(get, eventId, store.sessionId);
  if (event === null) return null;
  const delivery = bindOutboxDelivery(
    event,
    requireOutboxEvent(await get("events", eventId), eventId, store.sessionId),
  );
  const { ordinal } = delivery;
  if (ordinal > (await readOutboxTail(get)))
    throw immutableStorageError("Immutable event exceeds committed outbox tail");
  if ((await get("eventOrder", immutableOrderKey(ordinal))) !== eventId)
    throw immutableStorageError("Immutable event ordinal mismatch");
  return delivery;
}

export function readImmutableMigrationOutboxPage(store, snapshot, scope, { after, limit }) {
  return store.objects.withSnapshot(snapshot, async () => {
    const tail = await readImmutableOutboxTail(store, snapshot);
    const positions = [];
    const { cursor: end } = authorityOutboxCommittedPageWindow({ after, limit, tail });
    for (let ordinal = after + 1; ordinal <= end; ordinal += 1)
      positions.push(immutableOrderKey(ordinal));
    const order = await store.getMany(snapshot, "eventOrder", positions);
    const ids = positions.map((key, index) =>
      requireEventIdAtPosition(order.get(key), after + index + 1),
    );
    const events = await store.getMany(snapshot, "events", ids);
    const committed = ids.map((id, index) =>
      requireCommittedEvent(events.get(id), id, scope, after + index + 1),
    );
    const deliveries = await store.getMany(snapshot, "outbox", ids);
    const keys = new Set(
      committed.map(({ envelope }) => artifactRetirementKey(envelope.identity.turnScopeId)),
    );
    const retirements = await store.getMany(snapshot, "metadata", [...keys]);
    const records = [];
    for (const event of committed) {
      const { eventId } = event;
      const delivery = bindOutboxDelivery(
        requireOutboxEvent(deliveries.get(eventId), eventId, scope.sessionId),
        event,
      );
      let retired;
      try {
        retired = await isCommittedArtifactRetired((key) => retirements.get(key), event, tail);
      } catch (cause) {
        throw immutableStorageError(
          `Invalid source outbox retirement: ${artifactRetirementKey(event.envelope.identity.turnScopeId)}`,
          cause,
        );
      }
      if (retired && delivery !== null)
        throw immutableStorageError(`Retired source event remains deliverable: ${eventId}`);
      records.push({ committed: event, delivery, retired });
    }
    return { records, cursor: end };
  });
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
  requireAuthorityOutboxCursorAdvances(updates, AUTHORITY_OUTBOX_PAGE_LIMIT);
  const results = [];
  for (const update of updates) {
    const { consumerId, expectedCursor, cursor } = update;
    const header = await plan.get("metadata", "events");
    const previous =
      (await readCursor(
        (collection, key) => plan.get(collection, key),
        consumerId,
        header?.sequence,
      )) ?? 0;
    if (previous !== expectedCursor)
      throw Object.assign(new Error("Outbox consumer cursor conflict"), {
        code: "SESSION_OUTBOX_CURSOR_CONFLICT",
        currentCursor: previous,
      });
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
  requireAuthorityOutboxConsumer(consumerId);
  const get = (collection, key) => store.get(snapshot, collection, key);
  const tail = await readOutboxTail(get);
  if (after === undefined) after = (await readCursor(get, consumerId, tail)) ?? 0;
  requireAuthorityOutboxPagePosition(after, limit);
  if (after > tail) throw new TypeError("Outbox cursor exceeds the committed event sequence");
  const end = Math.min(tail, after + limit);
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
    hasMore: end < tail,
  };
}
