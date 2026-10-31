/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireOutbox, requireOutboxText, requireOutboxTime } from "./outbox-delivery.js";

export function assertAuthorityOutboxRequest(request, operation) {
  requireOutbox(isPlainObject(request), "request must be an object");
  requireOutboxText(request.userId, "userId");
  requireOutboxText(request.sessionId, "sessionId");
  if (operation === "compact") {
    requireOutboxTime(request.retainDeliveredAfter, "retainDeliveredAfter");
    return request;
  }
  requireOutboxText(request.consumerId, "consumerId");
  if (operation === "pending") return request;
  requireOutbox(operation === "attempt" || operation === "ack", "unknown request operation");
  const entries = operation === "attempt" ? request.eventIds : request.acknowledgements;
  requireOutbox(Array.isArray(entries) && entries.length > 0, "delivery batch must be non-empty");
  const eventIds = new Set();
  for (const entry of entries) {
    if (operation === "ack") {
      requireOutbox(isPlainObject(entry), "acknowledgement must be an object");
      requireOutboxText(entry.orderingDomain, "orderingDomain");
      requireOutboxText(entry.orderingScopeId, "orderingScopeId");
      requireOutbox(
        Number.isSafeInteger(entry.sequence) && entry.sequence >= 1,
        "sequence must be a positive integer",
      );
    }
    const eventId = requireOutboxText(operation === "attempt" ? entry : entry.eventId, "eventId");
    requireOutbox(!eventIds.has(eventId), `duplicate delivery eventId: ${eventId}`);
    eventIds.add(eventId);
  }
  return request;
}
