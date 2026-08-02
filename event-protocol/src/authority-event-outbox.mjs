/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateTurnLifecycleEnvelope } from "@noobot/event-protocol/turn-lifecycle";

const clean = (value) => String(value || "").trim();

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
  };
}

export function normalizeAuthorityEventOutbox(source = []) {
  const normalized = [];
  const eventIds = new Set();
  for (const item of Array.isArray(source) ? source : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const eventId = clean(item.eventId || item.envelope?.eventId);
    const envelope = item.envelope && typeof item.envelope === "object" && !Array.isArray(item.envelope)
      ? { ...item.envelope, eventId }
      : null;
    if (!eventId || eventIds.has(eventId) || !validateTurnLifecycleEnvelope(envelope || {}).valid) continue;
    eventIds.add(eventId);
    normalized.push({
      eventId,
      envelope,
      committedAt: clean(item.committedAt || envelope.occurredAt || envelope.updatedAt),
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

export function recordAuthorityEventDeliveryAttempt(source = [], { eventId = "", attemptedAt = "" } = {}) {
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

export function acknowledgeAuthorityEventDelivery(source = [], { eventId = "", deliveredAt = "" } = {}) {
  const normalizedEventId = clean(eventId);
  let found = false;
  let changed = false;
  const outbox = normalizeAuthorityEventOutbox(source).map((item) => {
    if (item.eventId !== normalizedEventId) return item;
    found = true;
    if (item.delivery.deliveredAt) return item;
    changed = true;
    return {
      ...item,
      delivery: {
        ...item.delivery,
        status: AUTHORITY_EVENT_DELIVERY_STATUS.DELIVERED,
        deliveredAt: clean(deliveredAt),
      },
    };
  });
  return { found, changed, outbox };
}

export function findAuthorityEventEnvelope(source = [], { commandId = "", eventType = "" } = {}) {
  const normalizedCommandId = clean(commandId);
  const normalizedEventType = clean(eventType);
  return normalizeAuthorityEventOutbox(source).find((item) =>
    clean(item.envelope.commandId) === normalizedCommandId &&
    clean(item.envelope.eventType) === normalizedEventType)?.envelope || null;
}

/**
 * Removes delivered events only after the caller supplies an explicit consumer
 * watermark and the exact committed result is durably present in a command
 * receipt. Pending or unreceipted events are never removed.
 */
export function compactAuthorityEventOutbox(source = [], {
  deliveredThroughSequence,
  retainDeliveredAfter = "",
  commandReceipts = [],
} = {}) {
  const watermark = Number(deliveredThroughSequence);
  if (!Number.isInteger(watermark) || watermark < 0) {
    return { compacted: false, reason: "invalid_delivery_watermark", removed: 0, outbox: normalizeAuthorityEventOutbox(source) };
  }
  const cutoff = clean(retainDeliveredAfter);
  if (!cutoff || !Number.isFinite(Date.parse(cutoff))) {
    return { compacted: false, reason: "invalid_retention_cutoff", removed: 0, outbox: normalizeAuthorityEventOutbox(source) };
  }
  const receipts = Array.isArray(commandReceipts) ? commandReceipts : [];
  const outbox = normalizeAuthorityEventOutbox(source);
  const retained = outbox.filter((item) => {
    if (!item.delivery.deliveredAt) return true;
    if (Number(item.envelope.sequence) > watermark) return true;
    if (Date.parse(item.delivery.deliveredAt) >= Date.parse(cutoff)) return true;
    const durableReceipt = receipts.find((receipt) =>
      clean(receipt?.commandId) === clean(item.envelope.commandId) &&
      clean(receipt?.eventType) === clean(item.envelope.eventType) &&
      clean(receipt?.eventId || receipt?.envelope?.eventId) === item.eventId &&
      validateTurnLifecycleEnvelope(receipt?.envelope || {}).valid,
    );
    return !durableReceipt;
  });
  return {
    compacted: retained.length !== outbox.length,
    removed: outbox.length - retained.length,
    outbox: retained,
  };
}
