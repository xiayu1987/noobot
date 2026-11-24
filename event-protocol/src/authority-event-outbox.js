/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { validateEventEnvelope } from "./envelope.js";
import { authorityOutboxPositionKey } from "./outbox-page.js";
export {
  assertAuthorityOutboxRequest,
  assertAuthorityOutboxAcknowledgementResult,
} from "./outbox-request.js";
export { AUTHORITY_OUTBOX_ERROR_CODE } from "./outbox-delivery.js";
export {
  parseAuthorityOutboxTurnRemoval,
  requireAuthorityOutboxTurnRange,
  appendAuthorityOutboxTurnRange,
  removeAuthorityOutboxTurnRange,
  isAuthorityOutboxTurnEventVisible,
  isAuthorityOutboxDeliveryVisible,
} from "./outbox-turn-removal.js";
export {
  AUTHORITY_OUTBOX_PAGE_LIMIT,
  authorityOutboxCommittedPageWindow,
  authorityOutboxPositionKey,
  decodeStoredAuthorityOutboxCursor,
  requireAuthorityOutboxConsumer,
  requireAuthorityOutboxEventPosition,
  requireAuthorityOutboxCursorAdvances,
  requireAuthorityOutboxMigrationPage,
  requireAuthorityOutboxPagePosition,
} from "./outbox-page.js";
import { isPlainObject, text, stableValue } from "@noobot/shared/value";
import {
  createPendingConsumerDelivery,
  readConsumerDelivery,
  readEventConsumerDelivery,
  readOutboxDeliveries,
  requireAcknowledgementOrdering,
  requireOutbox,
  requireOutboxText,
  requireOutboxTime,
} from "./outbox-delivery.js";

function validateAuthorityEnvelope(envelope) {
  return validateEventEnvelope(envelope).valid;
}

export function authorityEventConsumerDelivery(item, consumerId) {
  requireOutboxText(consumerId, "consumerId");
  requireOutbox(isPlainObject(item.deliveries), "deliveries must be an object");
  return Object.hasOwn(item.deliveries, consumerId)
    ? readEventConsumerDelivery(item.deliveries[consumerId], item.envelope)
    : createPendingConsumerDelivery();
}

export function normalizeAuthorityEventOutbox(source) {
  requireOutbox(Array.isArray(source), "entries must be an array");
  const normalized = [];
  const eventIds = new Set();
  for (const item of source) {
    requireOutbox(isPlainObject(item), "entry must be an object");
    const eventId = requireOutboxText(item.eventId, "eventId");
    const envelope = item.envelope;
    requireOutbox(validateAuthorityEnvelope(envelope), `invalid envelope: ${eventId}`);
    requireOutbox(eventId === envelope.identity.eventId, `eventId mismatch: ${eventId}`);
    requireOutbox(!eventIds.has(eventId), `duplicate eventId: ${eventId}`);
    eventIds.add(eventId);
    normalized.push({
      eventId,
      envelope,
      committedAt: requireOutboxTime(item.committedAt, "committedAt"),
      deliveries: readOutboxDeliveries(item.deliveries, envelope),
    });
  }
  return normalized;
}

export function decodeStoredAuthorityOutboxEvent(stored) {
  requireOutbox(
    isPlainObject(stored) &&
      Object.keys(stored).length === 4 &&
      ["ordinal", "envelope", "committedAt", "deliveries"].every((field) =>
        Object.hasOwn(stored, field),
      ),
    "invalid stored outbox event fields",
  );
  const { ordinal, envelope, committedAt, deliveries } = stored;
  authorityOutboxPositionKey(ordinal);
  return {
    ...normalizeAuthorityEventOutbox([
      { eventId: envelope?.identity?.eventId, envelope, committedAt, deliveries },
    ])[0],
    ordinal,
  };
}

export function encodeStoredAuthorityOutboxEvent({ ordinal, ...event }) {
  const { envelope, committedAt, deliveries } = event;
  const stored = { ordinal, envelope, committedAt, deliveries };
  if (
    JSON.stringify(stableValue(decodeStoredAuthorityOutboxEvent(stored))) !==
    JSON.stringify(stableValue({ ...event, ordinal }))
  )
    throw new TypeError("Authority event cannot be stored losslessly");
  return stored;
}

export function assertAuthorityEventScope(event, { sessionId, parentSessionId }) {
  const { identity, payload } = event.envelope;
  if (
    identity.sessionId !== sessionId ||
    (Object.hasOwn(payload, "parentSessionId") && payload.parentSessionId !== parentSessionId)
  )
    throw new TypeError("Authority event session ownership mismatch");
}

export function assertNewAuthorityEventScope(event, { sessionId, parentSessionId }) {
  assertAuthorityEventScope(event, { sessionId, parentSessionId });
  if (Object.keys(event.deliveries).length)
    throw new TypeError("New authority events cannot contain delivery acknowledgements");
}

export function assertUncommittedAuthorityEvent(existing) {
  if (existing !== null)
    throw Object.assign(new Error("Authority event ID is already committed"), {
      code: "SESSION_EVENT_CONFLICT",
    });
}

export function requireAuthorityEventSequenceFloor(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Invalid authority event sequence floor");
  return value;
}

export function assertAuthorityEventSequenceAdvance(envelope, floor) {
  if (envelope.ordering.sequence <= floor)
    throw Object.assign(new Error("Authority event sequence must advance its scope"), {
      code: "SESSION_EVENT_SEQUENCE_CONFLICT",
    });
}

export function projectAuthorityEventDeliveryResults(source, consumerId, results) {
  const normalized = normalizeAuthorityEventOutbox(source);
  requireOutboxText(consumerId, "consumerId");
  requireOutbox(
    Array.isArray(results) && results.length === normalized.length,
    "delivery result count must match the source batch",
  );
  return normalized.map((item, index) => {
    const result = results[index];
    requireOutbox(
      isPlainObject(result) && result.eventId === item.eventId,
      "delivery result identity must match the source batch",
    );
    const delivery = readEventConsumerDelivery(result.delivery, item.envelope);
    return { ...source[index], deliveries: { ...item.deliveries, [consumerId]: delivery } };
  });
}

export function migrateLegacyAuthorityEventOutbox(source = []) {
  return normalizeAuthorityEventOutbox(
    (Array.isArray(source) ? source : []).map((item) => {
      if (!isPlainObject(item)) return item;
      const legacy = isPlainObject(item.delivery) ? item.delivery : item;
      const consumerId = text(legacy.consumerId);
      const deliveries = {};
      if (consumerId) {
        deliveries[consumerId] = {
          ...createPendingConsumerDelivery(),
          attempts: legacy.attempts ?? item.deliveryAttempts ?? 0,
          lastAttemptAt: legacy.lastAttemptAt ?? "",
          deliveredAt: legacy.deliveredAt ?? "",
          orderingDomain: legacy.orderingDomain ?? "",
          orderingScopeId: legacy.orderingScopeId ?? "",
          sequence: legacy.sequence ?? 0,
        };
      }
      return {
        eventId: item.eventId,
        envelope: item.envelope,
        committedAt: item.committedAt ?? item.envelope.occurredAt,
        deliveries,
      };
    }),
  );
}

const AUTHORITY_OUTBOX_PENDING_BATCH_SIZE =
  QUANTITY_THRESHOLDS.eventProtocol.authorityOutboxPendingBatchSize;

function isUnownedLegacyAttempt(record) {
  return (
    isPlainObject(record) &&
    record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT &&
    !Object.hasOwn(record, "consumerId")
  );
}

export function migrateLegacyUnownedAttemptRecords(records) {
  requireOutbox(Array.isArray(records), "journal records must be an array");
  const kept = [];
  for (const [index, record] of records.entries()) {
    const covered =
      isUnownedLegacyAttempt(record) &&
      records
        .slice(index + 1)
        .some(
          (later) =>
            isPlainObject(later) &&
            later.op === AUTHORITY_OUTBOX_JOURNAL_OP.ACK &&
            later.eventId === record.eventId,
        );
    if (!covered) kept.push(record);
  }
  return { records: kept, changed: kept.length !== records.length };
}

function selectPendingAuthorityEvents(entries, consumerId) {
  const normalizedConsumerId = requireOutboxText(consumerId, "consumerId");
  const pending = [];
  for (const item of entries) {
    if (item.deliveries[normalizedConsumerId]?.deliveredAt) continue;
    pending.push(item);
    if (pending.length >= AUTHORITY_OUTBOX_PENDING_BATCH_SIZE) break;
  }
  return pending;
}

export function listPendingAuthorityEvents(source, { consumerId }) {
  return selectPendingAuthorityEvents(normalizeAuthorityEventOutbox(source), consumerId);
}

export function listPendingAuthorityOutboxProjection(projection, { consumerId }) {
  return selectPendingAuthorityEvents(projection.entries.values(), consumerId);
}

export const AUTHORITY_OUTBOX_JOURNAL_OP = Object.freeze({
  PREPARE: "prepare",
  COMMIT: "commit",
  ATTEMPT: "attempt",
  ACK: "ack",
  REMOVE: "remove",
});

export function migrateAuthorityOutboxJournalRecords(records) {
  requireOutbox(Array.isArray(records), "journal records must be an array");
  let changed = false;
  const migrated = records.flatMap((record) => {
    if (
      isPlainObject(record) &&
      record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT &&
      Object.hasOwn(record, "envelope")
    ) {
      const prepared = { ...record, op: AUTHORITY_OUTBOX_JOURNAL_OP.PREPARE };
      assertAuthorityOutboxJournalRecord(prepared);
      changed = true;
      return [prepared, { op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId: record.eventId }];
    }
    assertAuthorityOutboxJournalRecord(record);
    return [record];
  });
  projectAuthorityOutboxJournal(migrated);
  return { records: migrated, changed };
}

export function assertAuthorityOutboxJournalRecord(record) {
  requireOutbox(isPlainObject(record), "journal record must be an object");
  requireOutboxText(record.eventId, "eventId");
  requireOutbox(
    Object.values(AUTHORITY_OUTBOX_JOURNAL_OP).includes(record.op),
    `unknown journal operation: ${record.op}`,
  );
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.PREPARE) {
    normalizeAuthorityEventOutbox([{ ...record, deliveries: {} }]);
  } else if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) {
    requireOutbox(
      Object.keys(record).every((key) => ["op", "eventId"].includes(key)),
      "commit must reference a prepared event without copying its envelope",
    );
  } else if (record.op !== AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) {
    requireOutboxText(record.consumerId, "consumerId");
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT) {
      requireOutboxTime(record.attemptedAt, "attemptedAt");
    } else {
      requireOutboxTime(record.deliveredAt, "deliveredAt");
      readConsumerDelivery({ ...createPendingConsumerDelivery(), ...record });
    }
  }
  return record;
}

function withConsumerDelivery(item, consumerId, patch) {
  const current = authorityEventConsumerDelivery(item, consumerId);
  return {
    ...item,
    deliveries: {
      ...item.deliveries,
      [consumerId]: readConsumerDelivery({ ...current, ...patch }),
    },
  };
}

function withFrozenConsumerDelivery(item, consumerId, patch) {
  return deepFreeze(withConsumerDelivery(item, consumerId, patch));
}

export function createAuthorityOutboxProjection() {
  return { entries: new Map(), prepared: new Map(), removedEventIds: new Set() };
}

function seedAuthorityOutboxEvent(working, projection, eventId) {
  const entry = projection.entries.get(eventId);
  const prepared = projection.prepared.get(eventId);
  if (entry) working.entries.set(eventId, entry);
  if (prepared) working.prepared.set(eventId, prepared);
  if (projection.removedEventIds.has(eventId)) working.removedEventIds.add(eventId);
}

export function planAuthorityOutboxJournalRecords(projection, records) {
  requireOutbox(Array.isArray(records), "journal records must be an array");
  const working = createAuthorityOutboxProjection();
  const touched = new Set();
  for (const record of records) {
    const eventId = record?.eventId;
    if (!touched.has(eventId)) {
      touched.add(eventId);
      seedAuthorityOutboxEvent(working, projection, eventId);
    }
    applyAuthorityOutboxJournalRecord(working, record);
  }
  return working;
}

export function applyAuthorityOutboxJournalRecords(projection, records) {
  const working = planAuthorityOutboxJournalRecords(projection, records);
  for (const eventId of working.removedEventIds) {
    projection.entries.delete(eventId);
    projection.removedEventIds.add(eventId);
  }
  for (const [eventId, prepared] of working.prepared) projection.prepared.set(eventId, prepared);
  for (const [eventId, entry] of working.entries) projection.entries.set(eventId, entry);
  return projection;
}

export function planAuthorityOutboxAcknowledgements(projection, records) {
  requireOutbox(Array.isArray(records), "acknowledgements must be an array");
  const working = createAuthorityOutboxProjection();
  const changed = [];
  let delivered = 0;
  let deduplicated = 0;
  for (const record of records) {
    requireOutbox(record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ACK, "expected acknowledgement");
    const before = working.entries.get(record.eventId) || projection.entries.get(record.eventId);
    if (!before) {
      return { acknowledged: false, reason: "event_not_found", delivered, deduplicated };
    }
    working.entries.set(record.eventId, before);
    applyAuthorityOutboxJournalRecords(working, [record]);
    delivered += 1;
    if (working.entries.get(record.eventId) === before) deduplicated += 1;
    else changed.push(record);
  }
  return { acknowledged: true, delivered, deduplicated, records: changed };
}

export function listAuthorityOutboxProjection(projection) {
  return [...projection.entries.values()];
}

export function selectAuthorityOutboxProjection(projection, eventIds) {
  requireOutbox(Array.isArray(eventIds), "eventIds must be an array");
  const remaining = new Set(eventIds.map((eventId) => requireOutboxText(eventId, "eventId")));
  const selected = [];
  for (const [eventId, entry] of projection.entries) {
    if (!remaining.size) break;
    if (remaining.delete(eventId)) selected.push(entry);
  }
  return selected;
}

export function projectAuthorityOutboxJournal(records) {
  return listAuthorityOutboxProjection(
    applyAuthorityOutboxJournalRecords(createAuthorityOutboxProjection(), records),
  );
}

function applyAuthorityOutboxPrepare(prepared, record) {
  requireOutbox(isPlainObject(record), "journal record must be an object");
  const [committed] = normalizeAuthorityEventOutbox([
    {
      eventId: record.eventId,
      envelope: record.envelope,
      committedAt: record.committedAt,
      deliveries: {},
    },
  ]);
  const existing = prepared.get(committed.eventId);
  if (!existing) {
    prepared.set(committed.eventId, deepFreeze(committed));
    return;
  }
  requireOutbox(
    JSON.stringify(stableValue(existing.envelope)) ===
      JSON.stringify(stableValue(committed.envelope)) &&
      existing.committedAt === committed.committedAt,
    `conflicting commit: ${committed.eventId}`,
  );
}

function applyAuthorityOutboxJournalRecord(projection, record) {
  const byEventId = projection.entries;
  assertAuthorityOutboxJournalRecord(record);
  const eventId = record.eventId;
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.PREPARE) {
    applyAuthorityOutboxPrepare(projection.prepared, record);
    return;
  }
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) {
    const prepared = projection.prepared.get(eventId);
    requireOutbox(Boolean(prepared), `commit has no prepared event: ${eventId}`);
    if (!projection.removedEventIds.has(eventId) && !byEventId.has(eventId)) {
      byEventId.set(eventId, prepared);
    }
    return;
  }
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) {
    byEventId.delete(eventId);
    projection.removedEventIds.add(eventId);
    return;
  }
  const entry = byEventId.get(eventId);
  const consumerId = requireOutboxText(record.consumerId, "consumerId");
  requireOutbox(Boolean(entry), `delivery has no committed event: ${eventId}`);
  const current = authorityEventConsumerDelivery(entry, consumerId);
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT) {
    requireOutboxTime(record.attemptedAt, "attemptedAt");
    if (current.deliveredAt) return;
    byEventId.set(
      eventId,
      withFrozenConsumerDelivery(entry, consumerId, {
        attempts: current.attempts + 1,
        lastAttemptAt: record.attemptedAt,
      }),
    );
    return;
  }
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ACK) {
    requireOutboxTime(record.deliveredAt, "deliveredAt");
    requireAcknowledgementOrdering(record, entry.envelope);
    if (current.deliveredAt) return;
    byEventId.set(
      eventId,
      withFrozenConsumerDelivery(entry, consumerId, {
        deliveredAt: record.deliveredAt,
        orderingDomain: record.orderingDomain,
        orderingScopeId: record.orderingScopeId,
        sequence: record.sequence,
      }),
    );
  }
}

export function recordAuthorityEventDeliveryAttempt(source, { eventId, consumerId, attemptedAt }) {
  const normalizedEventId = requireOutboxText(eventId, "eventId");
  const normalizedConsumerId = requireOutboxText(consumerId, "consumerId");
  requireOutboxTime(attemptedAt, "attemptedAt");
  let found = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId) return item;
    found = true;
    const current = authorityEventConsumerDelivery(item, normalizedConsumerId);
    if (current.deliveredAt) return item;
    return withConsumerDelivery(item, normalizedConsumerId, {
      attempts: current.attempts + 1,
      lastAttemptAt: attemptedAt,
    });
  });
  return { found, outbox };
}

export function acknowledgeAuthorityEventDelivery(
  source,
  { eventId, consumerId, orderingDomain, orderingScopeId, sequence, deliveredAt },
) {
  const normalizedEventId = requireOutboxText(eventId, "eventId");
  const normalizedConsumerId = requireOutboxText(consumerId, "consumerId");
  const normalizedDomain = requireOutboxText(orderingDomain, "orderingDomain");
  const normalizedScopeId = requireOutboxText(orderingScopeId, "orderingScopeId");
  const normalizedSequence = sequence;
  requireOutboxTime(deliveredAt, "deliveredAt");
  requireOutbox(
    Number.isSafeInteger(sequence) && sequence >= 1,
    "sequence must be a positive integer",
  );
  let found = false;
  let changed = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId) return item;
    found = true;
    requireAcknowledgementOrdering(
      { orderingDomain: normalizedDomain, orderingScopeId: normalizedScopeId, sequence },
      item.envelope,
    );
    if (authorityEventConsumerDelivery(item, normalizedConsumerId).deliveredAt) return item;
    changed = true;
    return withConsumerDelivery(item, normalizedConsumerId, {
      deliveredAt,
      orderingDomain: normalizedDomain,
      orderingScopeId: normalizedScopeId,
      sequence: normalizedSequence,
    });
  });
  return { found, changed, outbox };
}

export function compactAuthorityEventOutbox(entries, { retainDeliveredAfter }) {
  const cutoff = Date.parse(requireOutboxTime(retainDeliveredAfter, "retainDeliveredAfter"));
  const retained = [];
  let removed = 0;
  let nextRetainedTime = Infinity;
  for (const item of entries) {
    const deliveries = Object.values(item.deliveries);
    let latestDelivery = -Infinity;
    for (const delivery of deliveries) {
      const deliveredAt = Date.parse(delivery.deliveredAt);
      if (!Number.isFinite(deliveredAt)) {
        latestDelivery = Infinity;
        break;
      }
      latestDelivery = Math.max(latestDelivery, deliveredAt);
    }
    if (deliveries.length && latestDelivery < cutoff) removed += 1;
    else {
      retained.push(item);
      if (Number.isFinite(latestDelivery))
        nextRetainedTime = Math.min(nextRetainedTime, latestDelivery);
    }
  }
  return {
    compacted: removed !== 0,
    removed,
    nextRetainedDeliveryAt: Number.isFinite(nextRetainedTime)
      ? new Date(nextRetainedTime).toISOString()
      : null,
    outbox: retained,
  };
}

export const AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION = 1;

export function authorityOutboxSequenceKey(orderingDomain, orderingScopeId) {
  const domain = text(orderingDomain);
  const scopeId = text(orderingScopeId);
  if (!domain || !scopeId) {
    throw new TypeError("authority outbox sequence key requires ordering domain and scope");
  }
  return `${domain}\u0000${scopeId}`;
}

function freezeSequenceFloors(sequenceFloors) {
  if (!isPlainObject(sequenceFloors)) {
    throw new TypeError("authority outbox checkpoint requires sequenceFloors object");
  }
  for (const [key, floor] of Object.entries(sequenceFloors)) {
    if (!text(key) || !Number.isInteger(floor) || floor < 1) {
      throw new TypeError(`authority outbox sequence floor must be an integer >= 1: ${key}`);
    }
  }
  return Object.freeze({ ...sequenceFloors });
}

export function createEmptyAuthorityOutboxCheckpoint() {
  return Object.freeze({ sequenceFloors: Object.freeze({}) });
}

export function parseAuthorityOutboxCheckpoint(payload) {
  if (!isPlainObject(payload)) {
    throw new TypeError("authority outbox checkpoint must be an object");
  }
  if (payload.schemaVersion !== AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION) {
    throw new TypeError(
      `unsupported authority outbox checkpoint schemaVersion: ${payload.schemaVersion}`,
    );
  }
  return Object.freeze({ sequenceFloors: freezeSequenceFloors(payload.sequenceFloors) });
}

export function serializeAuthorityOutboxCheckpoint(checkpoint) {
  return {
    schemaVersion: AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION,
    sequenceFloors: { ...freezeSequenceFloors(checkpoint.sequenceFloors) },
  };
}

export function readAuthorityOutboxSequenceFloor(checkpoint, key) {
  return Object.hasOwn(checkpoint.sequenceFloors, key) ? checkpoint.sequenceFloors[key] : 0;
}

function requireEnvelopeList(envelopes) {
  if (!Array.isArray(envelopes)) {
    throw new TypeError("authority sequence allocation requires an envelope list");
  }
  return envelopes;
}

export function allocateAuthorityEventSequence({
  checkpoint,
  envelopes,
  orderingDomain,
  orderingScopeId,
}) {
  const key = authorityOutboxSequenceKey(orderingDomain, orderingScopeId);
  let maximum = readAuthorityOutboxSequenceFloor(checkpoint, key);
  for (const envelope of requireEnvelopeList(envelopes)) {
    const { ordering } = envelope;
    if (ordering.domain !== orderingDomain || ordering.scopeId !== orderingScopeId) continue;
    maximum = Math.max(maximum, ordering.sequence);
  }
  return maximum + 1;
}

export function advanceAuthorityOutboxCheckpoint(checkpoint, envelopes) {
  const sequenceFloors = { ...checkpoint.sequenceFloors };
  for (const envelope of requireEnvelopeList(envelopes)) {
    const { ordering } = envelope;
    const key = authorityOutboxSequenceKey(ordering.domain, ordering.scopeId);
    sequenceFloors[key] = Math.max(
      readAuthorityOutboxSequenceFloor({ sequenceFloors }, key),
      ordering.sequence,
    );
  }
  return Object.freeze({ sequenceFloors: freezeSequenceFloors(sequenceFloors) });
}

export function requireCommittedAuthorityEvent(result) {
  if (!isPlainObject(result)) {
    throw new TypeError("authority event commit returned no result");
  }
  if (result.committed !== true) {
    const error = new Error(`authority event commit rejected: ${text(result.code)}`);
    error.code = result.code;
    throw error;
  }
  if (!validateAuthorityEnvelope(result.envelope)) {
    throw new TypeError("authority event commit returned an invalid envelope");
  }
  return result.envelope;
}
