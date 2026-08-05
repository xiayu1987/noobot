/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_LIFECYCLE_WIRE_EVENT,
  validateTurnLifecycleEnvelope,
} from "@noobot/session-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const clean = (value) => String(value || "").trim();

export function createAuthorityEventDispatcher({ resolveBot, sendEvent } = {}) {
  const inFlightByScope = new Map();

  const drainAuthorityEvents = async ({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceScope = null,
    limit = 100,
  } = {}) => {
    const identity = {
      userId: clean(userId),
      sessionId: clean(sessionId),
      parentSessionId: clean(parentSessionId),
      persistenceScope,
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
        const validation = validateTurnLifecycleEnvelope(item?.envelope);
        if (!eventId || eventId !== clean(item?.envelope?.eventId) || !validation.valid) {
          return {
            dispatched: false,
            reason: "invalid_authority_event_envelope",
            delivered,
            errors: validation.errors,
          };
        }
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
      clean(payload.persistenceScope?.scopeId),
    ].join("::");
    const active = inFlightByScope.get(key);
    if (active) {
      active.dirty = true;
      return active.promise;
    }

    const entry = { dirty: false, promise: null };
    entry.promise = (async () => {
      let delivered = 0;
      try {
        while (true) {
          entry.dirty = false;
          const result = await drainAuthorityEvents(payload);
          delivered += Number(result?.delivered || 0);
          if (result?.dispatched !== true) {
            if (inFlightByScope.get(key) === entry) inFlightByScope.delete(key);
            return { ...result, delivered };
          }
          if (entry.dirty) continue;

          // Delete before resolving so a later commit cannot attach to a drain
          // which has already made its final pending-event observation.
          if (inFlightByScope.get(key) === entry) inFlightByScope.delete(key);
          return { dispatched: true, delivered };
        }
      } catch (error) {
        if (inFlightByScope.get(key) === entry) inFlightByScope.delete(key);
        throw error;
      }
    })();
    inFlightByScope.set(key, entry);
    return entry.promise;
  };
}
