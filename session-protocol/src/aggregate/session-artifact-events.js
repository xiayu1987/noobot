/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

export function collectSessionArtifactEventIdentityErrors(events, sessionId) {
  if (!isCanonicalText(sessionId)) return ["invalid_session_id"];
  if (!Array.isArray(events)) return ["session_artifact_events_not_array"];
  const errors = [];
  const seen = new Set();
  for (const [index, event] of events.entries()) {
    if (!isPlainObject(event) || !isPlainObject(event.identity)) {
      errors.push(`invalid_artifact_event_identity:${index}`);
      continue;
    }
    const { eventId, sessionId: owner } = event.identity;
    if (!isCanonicalText(eventId)) errors.push(`invalid_artifact_event_id:${index}`);
    if (owner !== sessionId) errors.push(`artifact_event_session_mismatch:${index}`);
    if (seen.has(eventId)) errors.push(`duplicate_artifact_event_id:${index}`);
    seen.add(eventId);
  }
  return errors;
}

export function sessionArtifactEventsError(errors) {
  return Object.assign(new TypeError(`invalid session artifact events: ${errors.join(",")}`), {
    code: SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID,
    protocolErrors: errors,
  });
}
