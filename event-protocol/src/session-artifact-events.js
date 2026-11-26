/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectSessionArtifactEventIdentityErrors,
  sessionArtifactEventsError,
} from "@noobot/session-protocol/session-artifact-events";
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { validateProtocolEvent } from "./event-registry.js";

const verifiedImmutableEvents = new WeakMap();

export function assertSessionArtifactEvents(events, sessionId) {
  if (isDeepFrozen(events) && verifiedImmutableEvents.get(events) === sessionId) return events;
  const errors = collectSessionArtifactEventIdentityErrors(events, sessionId);
  if (errors.length) throw sessionArtifactEventsError(errors);
  for (const [index, event] of events.entries()) {
    const validation = validateProtocolEvent(event);
    if (!validation.valid) {
      errors.push(`invalid_artifact_event:${index}:${validation.errors.join(",")}`);
    } else if (!validation.descriptor.sessionArtifact) {
      errors.push(`event_not_session_artifact:${index}`);
    }
  }
  if (errors.length) throw sessionArtifactEventsError(errors);
  if (isDeepFrozen(events)) verifiedImmutableEvents.set(events, sessionId);
  return events;
}
