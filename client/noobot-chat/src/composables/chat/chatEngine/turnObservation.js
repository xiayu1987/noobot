/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();

/** Stable cross-layer observation shape. It contains no mutable domain state. */
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
  aliasPromoted = false,
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
    aliasPromoted: aliasPromoted === true,
    finalState: text(finalState),
    messageEffect: text(messageEffect || "none") || "none",
    ...details,
  };
}
