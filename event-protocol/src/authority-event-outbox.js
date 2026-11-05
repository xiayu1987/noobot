/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { validateEventEnvelope } from "./envelope.js";
export { assertAuthorityOutboxRequest } from "./outbox-request.js";
import { isPlainObject, text } from "@noobot/shared/value";
import {
  createPendingConsumerDelivery,
  readConsumerDelivery,
  readOutboxDeliveries,
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
    ? readConsumerDelivery(item.deliveries[consumerId])
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
      deliveries: readOutboxDeliveries(item.deliveries),
    });
  }
  return normalized;
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

/**
 * 存量规则：早期写入方的 attempt 记录不带 consumerId。
 * 之后已有同 eventId ack 的 attempt 不再承载送达事实，直接删除；
 * 未被 ack 覆盖的保持原样，由 assertAuthorityOutboxJournalRecord 拒绝，不推断归属。
 */
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

export function listPendingAuthorityEvents(source, { consumerId }) {
  const normalizedConsumerId = requireOutboxText(consumerId, "consumerId");
  return normalizeAuthorityEventOutbox(source)
    .filter((item) => !item.deliveries[normalizedConsumerId]?.deliveredAt)
    .slice(0, AUTHORITY_OUTBOX_PENDING_BATCH_SIZE);
}

export const AUTHORITY_OUTBOX_JOURNAL_OP = Object.freeze({
  COMMIT: "commit",
  ATTEMPT: "attempt",
  ACK: "ack",
  REMOVE: "remove",
});

export function assertAuthorityOutboxJournalRecord(record) {
  requireOutbox(isPlainObject(record), "journal record must be an object");
  requireOutboxText(record.eventId, "eventId");
  requireOutbox(
    Object.values(AUTHORITY_OUTBOX_JOURNAL_OP).includes(record.op),
    `unknown journal operation: ${record.op}`,
  );
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) {
    normalizeAuthorityEventOutbox([{ ...record, deliveries: {} }]);
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

export function projectAuthorityOutboxJournal(records) {
  requireOutbox(Array.isArray(records), "journal records must be an array");
  const byEventId = new Map();
  for (const record of records) {
    applyAuthorityOutboxJournalRecord(byEventId, record);
  }
  return normalizeAuthorityEventOutbox([...byEventId.values()]);
}

function applyAuthorityOutboxJournalRecord(byEventId, record) {
  assertAuthorityOutboxJournalRecord(record);
  const eventId = record.eventId;
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) {
    const [committed] = normalizeAuthorityEventOutbox([
      {
        eventId,
        envelope: record.envelope,
        committedAt: record.committedAt,
        deliveries: {},
      },
    ]);
    const existing = byEventId.get(eventId);
    if (existing) {
      requireOutbox(
        JSON.stringify(existing.envelope) === JSON.stringify(committed.envelope) &&
          existing.committedAt === committed.committedAt,
        `conflicting commit: ${eventId}`,
      );
    } else byEventId.set(eventId, committed);
    return;
  }
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) {
    byEventId.delete(eventId);
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
      withConsumerDelivery(entry, consumerId, {
        attempts: current.attempts + 1,
        lastAttemptAt: record.attemptedAt,
      }),
    );
    return;
  }
  if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ACK) {
    requireOutboxTime(record.deliveredAt, "deliveredAt");
    requireOutbox(
      record.orderingDomain === entry.envelope.ordering.domain &&
        record.orderingScopeId === entry.envelope.ordering.scopeId &&
        record.sequence === entry.envelope.ordering.sequence,
      `acknowledgement ordering mismatch: ${eventId}`,
    );
    if (current.deliveredAt) return;
    byEventId.set(
      eventId,
      withConsumerDelivery(entry, consumerId, {
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
    requireOutbox(
      item.envelope.ordering.domain === normalizedDomain &&
        item.envelope.ordering.scopeId === normalizedScopeId &&
        item.envelope.ordering.sequence === normalizedSequence,
      `acknowledgement ordering mismatch: ${eventId}`,
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

function isReclaimableDelivery(delivery, cutoff) {
  const deliveredAt = Date.parse(delivery.deliveredAt);
  return Number.isFinite(deliveredAt) && deliveredAt < cutoff;
}

export function compactAuthorityEventOutbox(source, { retainDeliveredAfter }) {
  const cutoff = Date.parse(requireOutboxTime(retainDeliveredAfter, "retainDeliveredAfter"));
  const outbox = normalizeAuthorityEventOutbox(source);
  const retained = outbox.filter((item) => {
    const deliveries = Object.values(item.deliveries);
    return (
      !deliveries.length || !deliveries.every((delivery) => isReclaimableDelivery(delivery, cutoff))
    );
  });
  return {
    compacted: retained.length !== outbox.length,
    removed: outbox.length - retained.length,
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
