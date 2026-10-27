/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

const ROUTE_IDENTITY_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
]);

const REQUIRED_NON_EMPTY_ROUTE_FIELDS = Object.freeze(["userId", "sessionId", "dialogProcessId"]);

export function requireExecutionRouteIdentity(route) {
  if (!isPlainObject(route)) {
    throw new TypeError("execution route identity must be an object");
  }
  const unknown = Object.keys(route).filter((key) => !ROUTE_IDENTITY_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`execution route identity has unknown fields: ${unknown.join(",")}`);
  }
  for (const field of ROUTE_IDENTITY_FIELDS) {
    if (typeof route[field] !== "string") {
      throw new TypeError(`execution route identity ${field} must be a string`);
    }
  }
  for (const field of REQUIRED_NON_EMPTY_ROUTE_FIELDS) {
    if (!route[field]) throw new TypeError(`execution route identity ${field} is required`);
  }
  return Object.freeze({ ...route });
}

export function omitExecutionRouteIdentity(data = {}) {
  const eventData = isPlainObject(data) ? data : {};
  const payload = { ...eventData };
  for (const field of ROUTE_IDENTITY_FIELDS) delete payload[field];
  return payload;
}

export function projectExecutionTransportPayload({ data, route }) {
  const eventData = isPlainObject(data) ? data : {};
  return { ...omitExecutionRouteIdentity(eventData), ...route };
}
