/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();

export function createTurnObservation({
  requestedSessionId = "",
  canonicalSessionId = "",
  turnKey = "",
  eventId = "",
  sequence = 0,
  source = "",
  authority = "none",
  applied = false,
  reason = "",
  finalState = "",
  messageEffect = "none",
  ...details
} = {}) {
  return {
    requestedSessionId: text(requestedSessionId),
    canonicalSessionId: text(canonicalSessionId || requestedSessionId),
    turnKey: text(turnKey),
    eventId: text(eventId),
    sequence: Number(sequence || 0),
    source: text(source),
    authority: text(authority || "none") || "none",
    applied: applied === true,
    reason: text(reason),
    finalState: text(finalState),
    messageEffect: text(messageEffect || "none") || "none",
    ...details,
  };
}
