/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

export function requireOutbox(condition, detail) {
  if (!condition) throw new TypeError(`invalid authority outbox: ${detail}`);
}

export function requireOutboxText(value, field) {
  requireOutbox(isCanonicalText(value), `${field} must be canonical text`);
  return value;
}

export function requireOutboxTime(value, field) {
  requireOutboxText(value, field);
  requireOutbox(Number.isFinite(Date.parse(value)), `${field} must be a timestamp`);
  return value;
}

export function createPendingConsumerDelivery() {
  return {
    status: "pending",
    attempts: 0,
    lastAttemptAt: "",
    deliveredAt: "",
    orderingDomain: "",
    orderingScopeId: "",
    sequence: 0,
  };
}

export function readConsumerDelivery(value) {
  requireOutbox(isPlainObject(value), "delivery must be an object");
  requireOutbox(
    Number.isSafeInteger(value.attempts) && value.attempts >= 0,
    "delivery attempts must be a non-negative integer",
  );
  if (value.attempts > 0) requireOutboxTime(value.lastAttemptAt, "lastAttemptAt");
  else requireOutbox(value.lastAttemptAt === "", "unattempted delivery has lastAttemptAt");
  if (value.deliveredAt !== "") {
    requireOutboxTime(value.deliveredAt, "deliveredAt");
    requireOutboxText(value.orderingDomain, "orderingDomain");
    requireOutboxText(value.orderingScopeId, "orderingScopeId");
    requireOutbox(
      Number.isSafeInteger(value.sequence) && value.sequence >= 1,
      "delivered sequence must be a positive integer",
    );
  } else {
    requireOutbox(
      value.orderingDomain === "" && value.orderingScopeId === "" && value.sequence === 0,
      "pending delivery cannot have acknowledgement coordinates",
    );
  }
  return {
    status: value.deliveredAt === "" ? "pending" : "delivered",
    attempts: value.attempts,
    lastAttemptAt: value.lastAttemptAt,
    deliveredAt: value.deliveredAt,
    orderingDomain: value.orderingDomain,
    orderingScopeId: value.orderingScopeId,
    sequence: value.sequence,
  };
}

export function readOutboxDeliveries(source) {
  requireOutbox(isPlainObject(source), "deliveries must be an object");
  return Object.fromEntries(
    Object.entries(source).map(([consumerId, value]) => [
      requireOutboxText(consumerId, "consumerId"),
      readConsumerDelivery(value),
    ]),
  );
}
