/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_LIFECYCLE_WIRE_EVENT,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

const ROUTE_IDENTITY_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
]);

export function omitExecutionRouteIdentity(data = {}) {
  const eventData = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const payload = { ...eventData };
  for (const field of ROUTE_IDENTITY_FIELDS) delete payload[field];
  return payload;
}

export function projectExecutionRouteIdentity(data = {}, route = {}) {
  return {
    ...omitExecutionRouteIdentity(data),
    userId: text(route.userId),
    dialogProcessId: text(route.dialogProcessId),
    sessionId: text(route.sessionId),
    turnScopeId: text(route.turnScopeId),
    parentSessionId: normalizeParentSessionId(route.parentSessionId),
  };
}

export function projectExecutionTransportPayload({ event = "", data = {}, route = {} } = {}) {
  const eventData = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (event === ATTACHMENT_LIFECYCLE_WIRE_EVENT) return createAttachmentLifecycleEvent(eventData);
  return projectExecutionRouteIdentity(eventData, route);
}
