/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
  PARTITION_SESSION_ARTIFACT_EVENTS,
} from "@noobot/session-protocol/partition-collections";
import {
  createPartitionMutationReader,
  PARTITION_LIFECYCLE_HEADER,
  requirePartitionOutboxTail,
} from "@noobot/session-protocol/partition-transaction";
import {
  acknowledgeAuthorityEventDelivery,
  authorityEventConsumerDelivery,
  authorityOutboxCommittedPageWindow,
  authorityOutboxPositionKey,
  AUTHORITY_OUTBOX_PAGE_LIMIT,
  compactAuthorityEventOutbox,
  decodeStoredAuthorityOutboxCursor,
  encodeStoredAuthorityOutboxEvent,
  recordAuthorityEventDeliveryAttempt,
  requireAuthorityOutboxConsumer,
  requireAuthorityOutboxCursorAdvances,
  requireAuthorityOutboxTurnRange,
  removeAuthorityOutboxTurnRange,
} from "@noobot/event-protocol/outbox";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  partitionCollectionResultBytes,
  requirePartitionCollectionPageLimit,
} from "@noobot/session-protocol/partition-collection-query";
import { isPlainObject } from "@noobot/shared/value";
import {
  partitionAuthorityEventRecord as eventRecord,
  partitionAuthorityEventVisible as visible,
  partitionEventTurnVisibility as outboxTurnVisibility,
  requireCommittedEventPosition,
} from "./partition-event-visibility.js";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import {
  isPartitionArtifactRetired,
  preparePartitionAuthorityEvents,
} from "./partition-artifact-events.js";

function corrupt(message, cause) {
  throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", message), { cause });
}

function admit(operation) {
  try {
    return operation();
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(
      new PartitionAdmissionRejection("SESSION_COMMIT_INPUT_INVALID", cause.message),
      {
        cause,
      },
    );
  }
}

async function readOutboxTail(get) {
  return requirePartitionOutboxTail(
    await get(PARTITION_LIFECYCLE_HEADER.collection, PARTITION_LIFECYCLE_HEADER.key),
  );
}

function consumerCursor(value, consumerId, sequence) {
  try {
    return decodeStoredAuthorityOutboxCursor(value, consumerId, sequence);
  } catch (cause) {
    corrupt("Invalid partition outbox consumer cursor", cause);
  }
}

function turnRange(value, turnScopeId, sequence) {
  try {
    return requireAuthorityOutboxTurnRange(value, turnScopeId, sequence);
  } catch (cause) {
    corrupt("Invalid partition outbox turn range", cause);
  }
}

function requireCommittedEventId(id) {
  if (typeof id !== "string" || !id) corrupt("Missing partition event position");
  return id;
}

function committedEvent(value, id, scope, ordinal) {
  const event = eventRecord(value, id, scope);
  if (event.ordinal !== ordinal) corrupt("Partition event ordinal mismatch");
  return event;
}

async function readCommittedRange(getMany, { after, end, scope }) {
  const positions = [];
  for (let sequence = after + 1; sequence <= end; sequence += 1)
    positions.push(authorityOutboxPositionKey(sequence));
  if (!positions.length) return [];
  const order = await getMany("eventOrder", positions);
  const ids = positions.map((key) => requireCommittedEventId(order.get(key)));
  if (new Set(ids).size !== ids.length) corrupt("Duplicate partition event position");
  const records = await getMany("events", ids);
  return ids.map((id, index) => committedEvent(records.get(id), id, scope, after + index + 1));
}

async function filterDeliverableEvents({ getMany, readVisibility }, events, tail) {
  if (!events.length) return events;
  const scopes = [...new Set(events.map((event) => event.envelope.identity.turnScopeId))];
  const [ranges, compactions, visibility] = await Promise.all([
    getMany("turnOutbox", scopes),
    getMany(
      PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
      events.map(({ eventId }) => eventId),
    ),
    readVisibility(scopes),
  ]);
  return events.filter((event) => {
    const turnScopeId = event.envelope.identity.turnScopeId;
    return (
      visible(event, ranges.get(turnScopeId), tail, compactions.get(event.eventId)) &&
      visibility.get(turnScopeId)
    );
  });
}

async function readRange(view, { after, end, scope, sequence }) {
  const events = await readCommittedRange(view.getMany, { after, end, scope });
  return filterDeliverableEvents(view, events, sequence);
}

function outboxMutationView(view, mutations) {
  const pending = new Map();
  for (const [index, mutation] of mutations.entries()) {
    if (!pending.has(mutation.collection)) pending.set(mutation.collection, new Map());
    pending.get(mutation.collection).set(mutation.key, { index, owner: mutation.owner, mutation });
  }
  const entries = async (collection, keys) => {
    if (!pending.has(collection)) pending.set(collection, new Map());
    const values = pending.get(collection);
    const missing = [...new Set(keys)].filter((key) => !values.has(key));
    if (missing.length) {
      const loaded = await view.getLatestMany({ collection, keys: missing });
      for (const [key, entry] of loaded) values.set(key, entry);
    }
    return new Map(keys.map((key) => [key, values.get(key)]));
  };
  const getMany = async (collection, keys) =>
    new Map(
      [...(await entries(collection, keys))].map(([key, entry]) => [
        key,
        entry === null || entry.mutation.remove ? null : entry.mutation.value,
      ]),
    );
  const get = async (collection, key) => (await getMany(collection, [key])).get(key);
  const set = (collection, key, value, previous) => {
    if (!pending.has(collection)) pending.set(collection, new Map());
    const staged = pending.get(collection);
    const current = staged.get(key);
    const mutation = { collection, key, value, owner: previous?.owner ?? null };
    const index = current && Object.hasOwn(current, "index") ? current.index : mutations.length;
    mutations[index] = mutation;
    staged.set(key, { index, owner: mutation.owner, mutation });
  };
  const read = createPartitionMutationReader(({ collection, keys }) => entries(collection, keys));
  return { entries, getMany, get, set, read };
}

async function readDeliveryTargets(view, deliveries, scope, sequence) {
  const ids = new Set();
  for (const update of deliveries) {
    admit(() => {
      if (!isPlainObject(update) || !["attempt", "acknowledge"].includes(update.type))
        throw new TypeError("Unknown outbox delivery update");
      requireAuthorityOutboxConsumer(update.consumerId);
      if (typeof update.eventId !== "string" || !update.eventId.trim())
        throw new TypeError("Outbox delivery requires an eventId");
    });
    ids.add(update.eventId);
  }
  const targets = await view.entries("events", [...ids]);
  const records = new Map();
  for (const [id, entry] of targets) {
    if (!entry || entry.mutation.remove)
      throw new PartitionAdmissionRejection(
        "SESSION_OUTBOX_EVENT_MISSING",
        "Authority event is missing",
      );
    const record = eventRecord(entry.mutation.value, id, scope);
    await requireCommittedEventPosition(view.get, record);
    records.set(id, { entry, record });
  }
  const visible = await filterDeliverableEvents(
    view,
    [...records.values()].map(({ record }) => record),
    sequence,
  );
  if (visible.length !== records.size)
    throw new PartitionAdmissionRejection(
      "SESSION_OUTBOX_EVENT_MISSING",
      "Authority event was removed",
    );
  return records;
}

async function prepareDeliveries(view, deliveries, { scope, sequence, limit }) {
  const results = [];

  for (let start = 0; start < deliveries.length; start += limit) {
    const page = deliveries.slice(start, start + limit);
    const records = await readDeliveryTargets(view, page, scope, sequence);
    for (const update of page)
      results.push(applyDeliveryUpdate(view, records.get(update.eventId), update));
  }
  return results;
}

function applyDeliveryUpdate({ set }, target, update) {
  const { ordinal, ...event } = target.record;
  const applied = admit(() =>
    update.type === "attempt"
      ? recordAuthorityEventDeliveryAttempt([event], update)
      : acknowledgeAuthorityEventDelivery([event], update),
  );
  const [next] = applied.outbox;
  if (JSON.stringify(next.deliveries) !== JSON.stringify(event.deliveries)) {
    target.record = { ...next, ordinal };
    set("events", update.eventId, encodeStoredAuthorityOutboxEvent(target.record), target.entry);
  }
  return {
    eventId: update.eventId,
    delivery: authorityEventConsumerDelivery(next, update.consumerId),
  };
}

async function prepareTurnRemovalPage({ entries, get, set }, turnScopeIds, sequence) {
  let removed = 0;
  const ranges = await entries("turnOutbox", turnScopeIds);
  for (const turnScopeId of turnScopeIds) {
    const previous = ranges.get(turnScopeId);
    if (!previous && (await get("lifecycle", turnScopeId)) !== null)
      corrupt("Missing partition outbox turn range");
    if (!previous) continue;
    const range = turnRange(previous.mutation.value, turnScopeId, sequence);
    removed += range.eventCount;
    if (range.eventCount)
      set(
        "turnOutbox",
        turnScopeId,
        removeAuthorityOutboxTurnRange(range, turnScopeId, sequence),
        previous,
      );
  }
  return removed;
}

async function prepareTurnRemoval(staged, { turnScopeIds }, sequence, { pageRecords }) {
  let removed = 0;
  for (let start = 0; start < turnScopeIds.length; start += pageRecords) {
    removed += await prepareTurnRemovalPage(
      staged,
      turnScopeIds.slice(start, start + pageRecords),
      sequence,
    );
  }
  return { removed };
}

function requireDeliveredEvents(events, consumerId) {
  for (const event of events) {
    if (authorityEventConsumerDelivery(event, consumerId).deliveredAt) continue;
    throw Object.assign(
      new PartitionAdmissionRejection(
        "SESSION_OUTBOX_CURSOR_UNDELIVERED",
        "Outbox cursor cannot skip an undelivered event",
      ),
      { eventId: event.eventId },
    );
  }
}

async function prepareCursors(view, outboxCursors, { scope, sequence }) {
  const { entries, set } = view;
  const results = [];
  for (const update of outboxCursors) {
    const { consumerId, expectedCursor, cursor } = update;
    const previous = (await entries("outboxConsumers", [consumerId])).get(consumerId);
    const current = consumerCursor(previous?.mutation.value ?? null, consumerId, sequence) ?? 0;
    if (current !== expectedCursor)
      throw Object.assign(
        new PartitionAdmissionRejection(
          "SESSION_OUTBOX_CURSOR_CONFLICT",
          "Outbox consumer cursor conflict",
        ),
        { currentCursor: current },
      );
    if (cursor > sequence)
      throw new PartitionAdmissionRejection(
        "SESSION_COMMIT_INPUT_INVALID",
        "Outbox cursor exceeds event sequence",
      );
    requireDeliveredEvents(
      await readRange(view, { after: current, end: cursor, scope, sequence }),
      consumerId,
    );
    if (cursor !== current) set("outboxConsumers", consumerId, { consumerId, cursor }, previous);
    results.push({ consumerId, cursor });
  }
  return results;
}

async function admitAuthorityEvents(staged, authorityEvents, scope) {
  try {
    return await preparePartitionAuthorityEvents(staged, authorityEvents, scope);
  } catch (cause) {
    if (
      !(cause instanceof TypeError) &&
      !["SESSION_EVENT_CONFLICT", "SESSION_EVENT_SEQUENCE_CONFLICT"].includes(cause.code)
    )
      throw cause;
    throw Object.assign(
      new PartitionAdmissionRejection(cause.code ?? "SESSION_COMMIT_INPUT_INVALID", cause.message),
      { cause },
    );
  }
}

async function prepareMaintenance(view, options, { scope, sequence, limit }) {
  const key = "outboxMaintenance";
  const previous = (await view.entries("metadata", [key])).get(key);
  const after = previous === null ? 0 : previous.mutation.value?.cursor;
  if (!Number.isSafeInteger(after) || after < 0 || after > sequence)
    corrupt("Invalid partition outbox maintenance cursor");
  const end = after + Math.min(limit, sequence - after);
  const events = await readRange(view, { after, end, scope, sequence });
  const { outbox, compacted, removed, nextRetainedDeliveryAt } = admit(() =>
    compactAuthorityEventOutbox(events, options),
  );
  const retained = new Set(outbox);
  for (const event of events)
    if (!retained.has(event))
      view.set(PARTITION_OUTBOX_DELIVERY_COMPACTIONS, event.eventId, true, null);
  const hasMore = end < sequence;
  view.set("metadata", key, { cursor: hasMore ? end : 0 }, previous);
  return { compacted, removed, scanned: end - after, hasMore, nextRetainedDeliveryAt };
}

export async function preparePartitionOutbox({ view, mutations, changes, scope, snapshot }) {
  const {
    deliveries = [],
    outboxCursors = [],
    artifactEvents: authorityEvents = [],
    outboxMaintenance,
  } = changes;
  if (!deliveries.length && !outboxCursors.length && !authorityEvents.length && !outboxMaintenance)
    return null;
  const limit = partitionOutboxPageLimit(snapshot);
  admit(() => requireAuthorityOutboxCursorAdvances(outboxCursors, limit));
  const staged = outboxMutationView(view, mutations);
  const pendingMessages = new Set(
    mutations.filter(({ collection }) => collection === "messages").map(({ key }) => key),
  );
  staged.readVisibility = outboxTurnVisibility(staged.read, (record, messageUid) =>
    checkPartitionMessageStorage(record, {
      snapshot,
      scope,
      messageUid,
      generation: view.generation + (pendingMessages.has(messageUid) ? 1 : 0),
    }),
  );
  const result = {};
  if (authorityEvents.length)
    result.eventIds = await admitAuthorityEvents(staged, authorityEvents, scope);
  const sequence = await readOutboxTail(staged.get);
  if (deliveries.length)
    result.deliveries = await prepareDeliveries(staged, deliveries, { scope, sequence, limit });
  if (outboxCursors.length)
    result.outboxCursors = await prepareCursors(staged, outboxCursors, { scope, sequence });
  if (outboxMaintenance)
    result.outboxMaintenance = await prepareMaintenance(staged, outboxMaintenance, {
      scope,
      sequence,
      limit,
    });
  return result;
}

export async function preparePartitionOutboxRetirement({
  view,
  mutations,
  snapshot,
  turnScopeIds,
}) {
  const staged = outboxMutationView(view, mutations);
  const sequence = await readOutboxTail(staged.get);
  return prepareTurnRemoval(staged, { turnScopeIds }, sequence, snapshot.limits);
}

function outboxReadView(read, scope, snapshot) {
  const getMany = async (collection, keys) =>
    new Map(
      [...(await read({ collection, keys }))].map(([key, mutation]) => [
        key,
        mutation?.value ?? null,
      ]),
    );
  const get = async (collection, key) => (await getMany(collection, [key])).get(key);
  const readVisibility = outboxTurnVisibility(read, (record, messageUid) =>
    checkPartitionMessageStorage(record, {
      snapshot,
      scope,
      messageUid,
      generation: snapshot.sequence,
    }),
  );
  return { get, getMany, readVisibility, read };
}

async function readVisibleOutboxEvent(view, snapshot, event) {
  const sequence = await requireCommittedEventPosition(view.get, event);
  if (!(await filterDeliverableEvents(view, [event], sequence)).length) return null;
  partitionCollectionResultBytes(event, snapshot.limits.pageBytes);
  return event;
}

export async function readPartitionOutboxEvent(read, scope, snapshot, eventId) {
  const view = outboxReadView(read, scope, snapshot);
  const stored = await view.get("events", eventId);
  if (stored === null) return null;
  return readVisibleOutboxEvent(view, snapshot, eventRecord(stored, eventId, scope));
}

function scanCommittedTurnInterjections(events, turnScopeId, remaining) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const { envelope } = events[index];
    if (envelope.identity.turnScopeId !== turnScopeId) continue;
    if (
      envelope.protocol.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
      envelope.payload.eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION
    ) {
      return { remaining, interjection: envelope.payload.contentFact };
    }
    if (--remaining === 0) break;
  }
  return { remaining, interjection: null };
}

export async function readPartitionLatestUserInterjection(readPage, scope, snapshot, turnScopeId) {
  const range = await readPage(async (read) => {
    const view = outboxReadView(read, scope, snapshot);
    const stored = await view.get("turnOutbox", turnScopeId);
    return stored === null ? null : turnRange(stored, turnScopeId, await readOutboxTail(view.get));
  });
  if (range === null) return null;
  let remaining = range.eventCount;
  let end = range.lastOrdinal;
  const limit = partitionOutboxPageLimit(snapshot);
  while (remaining > 0 && end > range.removedThrough) {
    const length = Math.min(limit, end - range.removedThrough);
    const committedEvents = await readPage((read) => {
      const view = outboxReadView(read, scope, snapshot);
      return read.readWindow(length, async (index) => {
        const ordinal = end - index;
        const id = requireCommittedEventId(
          await view.get("eventOrder", authorityOutboxPositionKey(ordinal)),
        );
        return committedEvent(await view.get("events", id), id, scope, ordinal);
      });
    });
    committedEvents.reverse();
    const page = scanCommittedTurnInterjections(committedEvents, turnScopeId, remaining);
    if (page.interjection !== null) return page.interjection;
    remaining = page.remaining;
    end -= committedEvents.length;
  }
  if (remaining !== 0) corrupt("Partition outbox turn range event count mismatch");
  return null;
}

async function readIndexedArtifactEvent(view, { scope, snapshot, id, membership }) {
  if (membership !== true) corrupt("Invalid partition session artifact index entry");
  const event = eventRecord(await view.get("events", id), id, scope);
  if (!getEventFamily(event.envelope.protocol.family).sessionArtifact)
    corrupt("Partition session artifact index references a non-artifact event");
  const tail = await requireCommittedEventPosition(view.get, event);
  if (await isPartitionArtifactRetired(view.read, event, tail)) return null;
  partitionCollectionResultBytes(event, snapshot.limits.pageBytes);
  return event;
}

export function readPartitionSessionArtifactEventWindow(read, scope, snapshot, { ids, offset }) {
  const view = outboxReadView(read, scope, snapshot);
  const length = Math.min(snapshot.limits.pageRecords, ids.length - offset);
  return read.readWindow(length, async (index) => {
    const id = ids[offset + index];
    const membership = await view.get(PARTITION_SESSION_ARTIFACT_EVENTS, id);
    return readIndexedArtifactEvent(view, { scope, snapshot, id, membership });
  });
}

function partitionOutboxPageLimit(snapshot) {
  return Math.min(AUTHORITY_OUTBOX_PAGE_LIMIT, snapshot.limits.pageRecords);
}

export async function readPartitionOutboxPage(read, scope, snapshot, { consumerId, after, limit }) {
  requireAuthorityOutboxConsumer(consumerId);
  if (limit === undefined) limit = partitionOutboxPageLimit(snapshot);
  requirePartitionCollectionPageLimit(snapshot, limit);
  const view = outboxReadView(read, scope, snapshot);
  const sequence = await readOutboxTail(view.get);
  if (after === undefined)
    after =
      consumerCursor(await view.get("outboxConsumers", consumerId), consumerId, sequence) ?? 0;
  const { cursor } = authorityOutboxCommittedPageWindow({ after, limit, tail: sequence });
  const records = await readRange(view, { after, end: cursor, scope, sequence });
  const events = records.flatMap((record) =>
    authorityEventConsumerDelivery(record, consumerId).deliveredAt ? [] : [record],
  );
  const page = { generation: snapshot.sequence, events, after, cursor, hasMore: cursor < sequence };
  partitionCollectionResultBytes(page, snapshot.limits.pageBytes);
  return page;
}
