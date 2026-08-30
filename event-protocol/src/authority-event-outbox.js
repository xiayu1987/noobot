/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateEventEnvelope } from "./envelope.js";

const clean = (value) => String(value || "").trim();

function validateAuthorityEnvelope(envelope = {}) {
  return validateEventEnvelope(envelope).valid;
}

export const AUTHORITY_EVENT_DELIVERY_STATUS = Object.freeze({
  PENDING: "pending",
  DELIVERED: "delivered",
});

function normalizeDelivery(item = {}) {
  const deliveredAt = clean(item.deliveredAt || item.delivery?.deliveredAt);
  return {
    status: deliveredAt
      ? AUTHORITY_EVENT_DELIVERY_STATUS.DELIVERED
      : AUTHORITY_EVENT_DELIVERY_STATUS.PENDING,
    attempts: Math.max(0, Number(item.deliveryAttempts ?? item.delivery?.attempts) || 0),
    lastAttemptAt: clean(item.lastAttemptAt || item.delivery?.lastAttemptAt),
    deliveredAt,
    consumerId: clean(item.consumerId || item.delivery?.consumerId),
    orderingDomain: clean(item.orderingDomain || item.delivery?.orderingDomain),
    orderingScopeId: clean(item.orderingScopeId || item.delivery?.orderingScopeId),
    sequence: Number(item.sequence ?? item.delivery?.sequence) || 0,
  };
}

export function normalizeAuthorityEventOutbox(source = []) {
  const normalized = [];
  const eventIds = new Set();
  for (const item of Array.isArray(source) ? source : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const eventId = clean(item.eventId);
    const envelope =
      item.envelope && typeof item.envelope === "object" && !Array.isArray(item.envelope)
        ? item.envelope
        : null;
    if (
      !eventId ||
      eventId !== clean(envelope?.identity?.eventId) ||
      eventIds.has(eventId) ||
      !validateAuthorityEnvelope(envelope)
    )
      continue;
    eventIds.add(eventId);
    normalized.push({
      eventId,
      envelope,
      committedAt: clean(item.committedAt || envelope.occurredAt),
      delivery: normalizeDelivery(item),
    });
  }
  return normalized;
}

export function listPendingAuthorityEvents(source = [], { limit = 100 } = {}) {
  const normalizedLimit = Math.max(0, Math.min(1000, Number(limit) || 100));
  return normalizeAuthorityEventOutbox(source)
    .filter((item) => item.delivery.status === AUTHORITY_EVENT_DELIVERY_STATUS.PENDING)
    .slice(0, normalizedLimit);
}

export function recordAuthorityEventDeliveryAttempt(
  source = [],
  { eventId = "", attemptedAt = "" } = {},
) {
  const normalizedEventId = clean(eventId);
  let found = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId || item.delivery.deliveredAt) return item;
    found = true;
    return {
      ...item,
      delivery: {
        ...item.delivery,
        attempts: item.delivery.attempts + 1,
        lastAttemptAt: clean(attemptedAt),
      },
    };
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
  const normalizedEventId = clean(eventId);
  const normalizedConsumerId = clean(consumerId);
  const normalizedDomain = clean(orderingDomain);
  const normalizedScopeId = clean(orderingScopeId);
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
    if (item.delivery.deliveredAt) return item;
    changed = true;
    return {
      ...item,
      delivery: {
        ...item.delivery,
        status: AUTHORITY_EVENT_DELIVERY_STATUS.DELIVERED,
        deliveredAt: clean(deliveredAt),
        consumerId: normalizedConsumerId,
        orderingDomain: normalizedDomain,
        orderingScopeId: normalizedScopeId,
        sequence: normalizedSequence,
      },
    };
  });
  return { found, changed, outbox };
}

/**
 * Removes events only from explicit durable delivery acknowledgements for one
 * consumer and one ordering stream. No domain fact or command receipt is used
 * to infer delivery.
 */
export function compactAuthorityEventOutbox(
  source = [],
  {
    consumerId = "",
    orderingDomain = "",
    orderingScopeId = "",
    deliveredThroughSequence,
    retainDeliveredAfter = "",
  } = {},
) {
  const normalizedConsumerId = clean(consumerId);
  const normalizedDomain = clean(orderingDomain);
  const normalizedScopeId = clean(orderingScopeId);
  const watermark = Number(deliveredThroughSequence);
  if (
    !normalizedConsumerId ||
    !normalizedDomain ||
    !normalizedScopeId ||
    !Number.isInteger(watermark) ||
    watermark < 0
  ) {
    return {
      compacted: false,
      reason: "invalid_delivery_watermark",
      removed: 0,
      outbox: normalizeAuthorityEventOutbox(source),
    };
  }
  const cutoff = clean(retainDeliveredAfter);
  if (!cutoff || !Number.isFinite(Date.parse(cutoff))) {
    return {
      compacted: false,
      reason: "invalid_retention_cutoff",
      removed: 0,
      outbox: normalizeAuthorityEventOutbox(source),
    };
  }
  const outbox = normalizeAuthorityEventOutbox(source);
  const retained = outbox.filter((item) => {
    if (!item.delivery.deliveredAt) return true;
    if (item.delivery.consumerId !== normalizedConsumerId) return true;
    if (
      item.delivery.orderingDomain !== normalizedDomain ||
      item.delivery.orderingScopeId !== normalizedScopeId
    )
      return true;
    if (item.delivery.sequence > watermark) return true;
    if (Date.parse(item.delivery.deliveredAt) >= Date.parse(cutoff)) return true;
    return false;
  });
  return {
    compacted: retained.length !== outbox.length,
    removed: outbox.length - retained.length,
    outbox: retained,
  };
}
