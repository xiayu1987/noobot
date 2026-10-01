/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateEventEnvelope } from "./envelope.js";
import { text } from "./normalize.js";

function validateAuthorityEnvelope(envelope = {}) {
  return validateEventEnvelope(envelope).valid;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const AUTHORITY_EVENT_DELIVERY_STATUS = Object.freeze({
  PENDING: "pending",
  DELIVERED: "delivered",
});

function normalizeConsumerDelivery(value = {}) {
  const deliveredAt = text(value.deliveredAt);
  return {
    status: deliveredAt
      ? AUTHORITY_EVENT_DELIVERY_STATUS.DELIVERED
      : AUTHORITY_EVENT_DELIVERY_STATUS.PENDING,
    attempts: Math.max(0, Number(value.attempts) || 0),
    lastAttemptAt: text(value.lastAttemptAt),
    deliveredAt,
    orderingDomain: text(value.orderingDomain),
    orderingScopeId: text(value.orderingScopeId),
    sequence: Number(value.sequence) || 0,
  };
}

function normalizeDeliveries(source = {}) {
  const deliveries = {};
  if (!isPlainObject(source)) return deliveries;
  for (const [consumerId, value] of Object.entries(source)) {
    const normalizedConsumerId = text(consumerId);
    if (!normalizedConsumerId || !isPlainObject(value)) continue;
    deliveries[normalizedConsumerId] = normalizeConsumerDelivery(value);
  }
  return deliveries;
}

export function authorityEventConsumerDelivery(item = {}, consumerId = "") {
  const normalizedConsumerId = text(consumerId);
  const delivery = normalizedConsumerId ? item?.deliveries?.[normalizedConsumerId] : null;
  return delivery ? normalizeConsumerDelivery(delivery) : normalizeConsumerDelivery({});
}

export function normalizeAuthorityEventOutbox(source = []) {
  const normalized = [];
  const eventIds = new Set();
  for (const item of Array.isArray(source) ? source : []) {
    if (!isPlainObject(item)) continue;
    const eventId = text(item.eventId);
    const envelope = isPlainObject(item.envelope) ? item.envelope : null;
    if (
      !eventId ||
      eventId !== text(envelope?.identity?.eventId) ||
      eventIds.has(eventId) ||
      !validateAuthorityEnvelope(envelope)
    )
      continue;
    eventIds.add(eventId);
    normalized.push({
      eventId,
      envelope,
      committedAt: text(item.committedAt || envelope.occurredAt),
      deliveries: normalizeDeliveries(item.deliveries),
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
          attempts: legacy.attempts ?? item.deliveryAttempts,
          lastAttemptAt: legacy.lastAttemptAt,
          deliveredAt: legacy.deliveredAt,
          orderingDomain: legacy.orderingDomain,
          orderingScopeId: legacy.orderingScopeId,
          sequence: legacy.sequence,
        };
      }
      return {
        eventId: item.eventId,
        envelope: item.envelope,
        committedAt: item.committedAt,
        deliveries,
      };
    }),
  );
}

export function listPendingAuthorityEvents(source = [], { consumerId = "", limit = 100 } = {}) {
  const normalizedConsumerId = text(consumerId);
  if (!normalizedConsumerId) return [];
  const normalizedLimit = Math.max(0, Math.min(1000, Number(limit) || 100));
  return normalizeAuthorityEventOutbox(source)
    .filter((item) => !item.deliveries[normalizedConsumerId]?.deliveredAt)
    .slice(0, normalizedLimit);
}

export const AUTHORITY_OUTBOX_JOURNAL_OP = Object.freeze({
  COMMIT: "commit",
  ATTEMPT: "attempt",
  ACK: "ack",
  REMOVE: "remove",
});

function withConsumerDelivery(item, consumerId, patch) {
  const current = authorityEventConsumerDelivery(item, consumerId);
  return {
    ...item,
    deliveries: {
      ...item.deliveries,
      [consumerId]: normalizeConsumerDelivery({ ...current, ...patch }),
    },
  };
}

export function projectAuthorityOutboxJournal(records = []) {
  const byEventId = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!isPlainObject(record)) continue;
    const eventId = text(record.eventId);
    if (!eventId) continue;
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) {
      if (byEventId.has(eventId)) continue;
      byEventId.set(eventId, {
        eventId,
        envelope: record.envelope,
        committedAt: text(record.committedAt),
        deliveries: {},
      });
      continue;
    }
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) {
      byEventId.delete(eventId);
      continue;
    }
    const entry = byEventId.get(eventId);
    const consumerId = text(record.consumerId);
    if (!entry || !consumerId) continue;
    const current = authorityEventConsumerDelivery(entry, consumerId);
    if (current.deliveredAt) continue;
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT) {
      byEventId.set(
        eventId,
        withConsumerDelivery(entry, consumerId, {
          attempts: current.attempts + 1,
          lastAttemptAt: text(record.attemptedAt),
        }),
      );
      continue;
    }
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.ACK) {
      byEventId.set(
        eventId,
        withConsumerDelivery(entry, consumerId, {
          deliveredAt: text(record.deliveredAt),
          orderingDomain: text(record.orderingDomain),
          orderingScopeId: text(record.orderingScopeId),
          sequence: Number(record.sequence) || 0,
        }),
      );
    }
  }
  return normalizeAuthorityEventOutbox([...byEventId.values()]);
}

export function recordAuthorityEventDeliveryAttempt(
  source = [],
  { eventId = "", consumerId = "", attemptedAt = "" } = {},
) {
  const normalizedEventId = text(eventId);
  const normalizedConsumerId = text(consumerId);
  if (!normalizedConsumerId) {
    return {
      found: false,
      reason: "missing_delivery_consumer",
      outbox: normalizeAuthorityEventOutbox(source),
    };
  }
  let found = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId) return item;
    const current = authorityEventConsumerDelivery(item, normalizedConsumerId);
    if (current.deliveredAt) return item;
    found = true;
    return withConsumerDelivery(item, normalizedConsumerId, {
      attempts: current.attempts + 1,
      lastAttemptAt: text(attemptedAt),
    });
  });
  return { found, outbox };
}

export function acknowledgeAuthorityEventDelivery(
  source = [],
  {
    eventId = "",
    consumerId = "",
    orderingDomain = "",
    orderingScopeId = "",
    sequence,
    deliveredAt = "",
  } = {},
) {
  const normalizedEventId = text(eventId);
  const normalizedConsumerId = text(consumerId);
  const normalizedDomain = text(orderingDomain);
  const normalizedScopeId = text(orderingScopeId);
  const normalizedSequence = Number(sequence);
  if (
    !normalizedConsumerId ||
    !normalizedDomain ||
    !normalizedScopeId ||
    !Number.isInteger(normalizedSequence) ||
    normalizedSequence < 1
  ) {
    return {
      found: false,
      changed: false,
      reason: "invalid_delivery_acknowledgement",
      outbox: normalizeAuthorityEventOutbox(source),
    };
  }
  let found = false;
  let changed = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId) return item;
    found = true;
    if (
      item.envelope.ordering.domain !== normalizedDomain ||
      item.envelope.ordering.scopeId !== normalizedScopeId ||
      Number(item.envelope.ordering.sequence) !== normalizedSequence
    )
      return item;
    if (authorityEventConsumerDelivery(item, normalizedConsumerId).deliveredAt) return item;
    changed = true;
    return withConsumerDelivery(item, normalizedConsumerId, {
      deliveredAt: text(deliveredAt),
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

export function compactAuthorityEventOutbox(source = [], { retainDeliveredAfter = "" } = {}) {
  const cutoff = Date.parse(text(retainDeliveredAfter));
  if (!Number.isFinite(cutoff)) {
    return {
      compacted: false,
      reason: "invalid_retention_cutoff",
      removed: 0,
      outbox: normalizeAuthorityEventOutbox(source),
    };
  }
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
