/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/authoritative-state/contracts";

const clean = (value) => String(value || "").trim();

export function createAuthorityEventDispatcher({ resolveBot, sendEvent } = {}) {
  return async function dispatchAuthorityEvents({ userId, sessionId, parentSessionId = "", limit = 100 } = {}) {
    const identity = {
      userId: clean(userId),
      sessionId: clean(sessionId),
      parentSessionId: clean(parentSessionId),
    };
    if (!identity.userId || !identity.sessionId) {
      return { dispatched: false, reason: "missing_session_identity", delivered: 0 };
    }
    const bot = resolveBot?.();
    if (
      typeof bot?.getPendingAuthorityEvents !== "function" ||
      typeof bot?.recordAuthorityEventAttempt !== "function" ||
      typeof bot?.acknowledgeAuthorityEvent !== "function"
    ) {
      throw new Error("authority event outbox API is required");
    }
    const pending = await bot.getPendingAuthorityEvents({ ...identity, limit });
    if (!pending?.found) {
      return { dispatched: false, reason: pending?.reason || "authority_outbox_unavailable", delivered: 0 };
    }

    let delivered = 0;
    for (const item of pending.events || []) {
      const eventId = clean(item?.eventId);
      if (!eventId || !item?.envelope) continue;
      const attempt = await bot.recordAuthorityEventAttempt({ ...identity, eventId });
      if (!attempt?.recorded) {
        return { dispatched: false, reason: attempt?.reason || "authority_event_attempt_failed", delivered };
      }
      const sent = await sendEvent?.(TURN_LIFECYCLE_WIRE_EVENT, item.envelope);
      if (sent !== true) {
        return { dispatched: false, reason: "authority_event_send_failed", delivered };
      }
      const acknowledged = await bot.acknowledgeAuthorityEvent({ ...identity, eventId });
      if (!acknowledged?.acknowledged) {
        return { dispatched: false, reason: acknowledged?.reason || "authority_event_ack_failed", delivered };
      }
      delivered += 1;
    }
    return { dispatched: true, delivered };
  };
}
