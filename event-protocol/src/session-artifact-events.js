/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectSessionArtifactEventIdentityErrors,
  sessionArtifactEventsError,
} from "@noobot/session-protocol";
import { validateProtocolEvent } from "./event-registry.js";

export function assertSessionArtifactEvents(events, sessionId) {
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
  return events;
}
