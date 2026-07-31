/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/authoritative-state/contracts";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const clean = (value) => String(value || "").trim();

export function createAuthorityEventDispatcher({ resolveBot, sendEvent } = {}) {
  const inFlightByScope = new Map();

  const drainAuthorityEvents = async ({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
    limit = 100,
  } = {}) => {
    const identity = {
      userId: clean(userId),
      sessionId: clean(sessionId),
      parentSessionId: clean(parentSessionId),
      persistenceContext,
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
    let delivered = 0;
    let deliveredThroughSequence = 0;
    while (true) {
      const pending = await bot.getPendingAuthorityEvents({ ...identity, limit });
      if (!pending?.found) {
        return { dispatched: false, reason: pending?.reason || "authority_outbox_unavailable", delivered };
      }
      const events = Array.isArray(pending.events) ? pending.events : [];
      if (!events.length) break;
      for (const item of events) {
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
        deliveredThroughSequence = Math.max(
          deliveredThroughSequence,
          Number(item.envelope.sequence || 0),
        );
      }
    }
    if (deliveredThroughSequence > 0 && typeof bot.compactAuthorityEvents === "function") {
      const retainDeliveredAfter = new Date(
        Date.now() - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
      ).toISOString();
      try {
        await bot.compactAuthorityEvents({
          ...identity,
          deliveredThroughSequence,
          retainDeliveredAfter,
        });
      } catch {
        // Delivery is already durable; compaction remains best-effort housekeeping.
      }
    }
    return { dispatched: true, delivered };
  };

  return function dispatchAuthorityEvents(payload = {}) {
    const key = [
      clean(payload.userId),
      clean(payload.sessionId),
      clean(payload.persistenceContext?.scopeId),
    ].join("::");
    const active = inFlightByScope.get(key);
    if (active) return active;
    const operation = drainAuthorityEvents(payload).finally(() => {
      if (inFlightByScope.get(key) === operation) inFlightByScope.delete(key);
    });
    inFlightByScope.set(key, operation);
    return operation;
  };
}
