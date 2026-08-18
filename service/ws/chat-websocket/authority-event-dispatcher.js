/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateProtocolEvent } from "@noobot/event-protocol";
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
  } = {}, publishEvent = sendEvent) => {
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
    const consumerId = "service.websocket";
    const watermarks = new Map();
    while (true) {
      const pending = await bot.getPendingAuthorityEvents({ ...identity, limit });
      if (!pending?.found) {
        return { dispatched: false, reason: pending?.reason || "authority_outbox_unavailable", delivered };
      }
      const events = Array.isArray(pending.events) ? pending.events : [];
      if (!events.length) break;
      for (const item of events) {
        const eventId = clean(item?.eventId);
        const validation = validateProtocolEvent(item?.envelope);
        if (!eventId || eventId !== clean(item?.envelope?.identity?.eventId) || !validation.valid) {
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
        if (typeof publishEvent !== "function") {
          return { dispatched: false, reason: "authority_event_transport_unavailable", delivered };
        }
        const sent = await publishEvent(item.envelope.identity.eventType, item.envelope);
        if (sent !== true) {
          return { dispatched: false, reason: "authority_event_send_failed", delivered };
        }
        const orderingDomain = clean(item.envelope.ordering.domain);
        const orderingScopeId = clean(item.envelope.ordering.scopeId);
        const sequence = Number(item.envelope.ordering.sequence);
        const acknowledged = await bot.acknowledgeAuthorityEvent({
          ...identity,
          eventId,
          consumerId,
          orderingDomain,
          orderingScopeId,
          sequence,
        });
        if (!acknowledged?.acknowledged) {
          return { dispatched: false, reason: acknowledged?.reason || "authority_event_ack_failed", delivered };
        }
        delivered += 1;
        const streamKey = `${orderingDomain}\u0000${orderingScopeId}`;
        watermarks.set(streamKey, {
          orderingDomain,
          orderingScopeId,
          deliveredThroughSequence: Math.max(sequence, watermarks.get(streamKey)?.deliveredThroughSequence || 0),
        });
      }
    }
    if (watermarks.size && typeof bot.compactAuthorityEvents === "function") {
      const retainDeliveredAfter = new Date(
        Date.now() - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
      ).toISOString();
      for (const watermark of watermarks.values()) {
        await bot.compactAuthorityEvents({
          ...identity,
          consumerId,
          ...watermark,
          retainDeliveredAfter,
        });
      }
    }
    return { dispatched: true, delivered };
  };

  return function dispatchAuthorityEvents(payload = {}, publishEvent = sendEvent) {
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
          const result = await drainAuthorityEvents(payload, publishEvent);
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
