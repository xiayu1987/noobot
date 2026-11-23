/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireOutbox, requireOutboxText, requireOutboxTime } from "./outbox-delivery.js";
import { AUTHORITY_OUTBOX_PAGE_LIMIT } from "./outbox-page.js";

export function assertAuthorityOutboxRequest(request, operation) {
  requireOutbox(isPlainObject(request), "request must be an object");
  requireOutboxText(request.userId, "userId");
  requireOutboxText(request.sessionId, "sessionId");
  if (operation === "compact") {
    requireOutboxTime(request.retainDeliveredAfter, "retainDeliveredAfter");
    return request;
  }
  requireOutboxText(request.consumerId, "consumerId");
  if (operation === "pending" || operation === "prepareDelivery") return request;
  requireOutbox(operation === "ack", "unknown request operation");
  const entries = request.acknowledgements;
  requireOutbox(
    Array.isArray(entries) && entries.length > 0 && entries.length <= AUTHORITY_OUTBOX_PAGE_LIMIT,
    "delivery batch must fit one outbox page",
  );
  const eventIds = new Set();
  for (const entry of entries) {
    requireOutbox(isPlainObject(entry), "acknowledgement must be an object");
    requireOutboxText(entry.orderingDomain, "orderingDomain");
    requireOutboxText(entry.orderingScopeId, "orderingScopeId");
    requireOutbox(
      Number.isSafeInteger(entry.sequence) && entry.sequence >= 1,
      "sequence must be a positive integer",
    );
    const eventId = requireOutboxText(entry.eventId, "eventId");
    requireOutbox(!eventIds.has(eventId), `duplicate delivery eventId: ${eventId}`);
    eventIds.add(eventId);
  }
  return request;
}

export function assertAuthorityOutboxAcknowledgementResult(result) {
  requireOutbox(isPlainObject(result), "acknowledgement result must be an object");
  requireOutbox(typeof result.acknowledged === "boolean", "acknowledged must be a boolean");
  if (result.acknowledged)
    requireOutbox(typeof result.drained === "boolean", "drained must be a boolean");
  return result;
}
