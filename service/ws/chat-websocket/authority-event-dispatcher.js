/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateProtocolEvent } from "@noobot/event-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const clean = (value) => String(value || "").trim();

export const AUTHORITY_EVENT_CONSUMER = Object.freeze({
  WEBSOCKET: "service.websocket",
  CLI: "service.cli",
});

const KNOWN_CONSUMERS = new Set(Object.values(AUTHORITY_EVENT_CONSUMER));

function findInvalidAuthorityEvent(events) {
  for (const item of events) {
    const eventId = clean(item?.eventId);
    const validation = validateProtocolEvent(item?.envelope);
    if (!eventId || eventId !== clean(item?.envelope?.identity?.eventId) || !validation.valid) {
      return validation;
    }
  }
  return null;
}

async function publishAuthorityEvents(events, publishEvent) {
  const acknowledgements = [];
  for (const item of events) {
    const sent = await publishEvent(item.envelope.identity.eventType, item.envelope);
    if (sent !== true) return { acknowledgements, sendFailed: true };
    acknowledgements.push({
      eventId: clean(item.eventId),
      orderingDomain: clean(item.envelope.ordering.domain),
      orderingScopeId: clean(item.envelope.ordering.scopeId),
      sequence: Number(item.envelope.ordering.sequence),
    });
  }
  return { acknowledgements, sendFailed: false };
}

async function compactAuthorityEventsIfDue(bot, identity, lastCompactAtBySession) {
  if (typeof bot.compactAuthorityEvents !== "function") return;
  const now = Date.now();
  const accountingKey = `${identity.userId}\u0000${identity.sessionId}\u0000${clean(
    identity.persistenceScope?.scopeId,
  )}`;
  const lastCompactAt = lastCompactAtBySession.get(accountingKey);
  if (
    lastCompactAt !== undefined &&
    now - lastCompactAt < TIME_THRESHOLDS.agent.authorityOutboxCompactIntervalMs
  ) {
    return;
  }
  await bot.compactAuthorityEvents({
    ...identity,
    retainDeliveredAfter: new Date(
      now - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
    ).toISOString(),
  });
  lastCompactAtBySession.set(accountingKey, now);
}

export function createAuthorityEventDispatcher({ resolveBot, sendEvent, consumerId } = {}) {
  const normalizedConsumerId = clean(consumerId);
  if (!KNOWN_CONSUMERS.has(normalizedConsumerId)) {
    throw new Error(`authority event consumerId is required: ${normalizedConsumerId || "<empty>"}`);
  }
  const inFlightByScope = new Map();
  const lastCompactAtBySession = new Map();

  const drainAuthorityEvents = async (
    { userId, sessionId, parentSessionId = "", persistenceScope = null, limit = 100 } = {},
    publishEvent = sendEvent,
  ) => {
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
      typeof bot?.recordAuthorityEventAttempts !== "function" ||
      typeof bot?.acknowledgeAuthorityEvents !== "function"
    ) {
      throw new Error("authority event outbox API is required");
    }
    let delivered = 0;
    const consumerId = normalizedConsumerId;
    while (true) {
      const pending = await bot.getPendingAuthorityEvents({ ...identity, consumerId, limit });
      if (!pending?.found) {
        return {
          dispatched: false,
          reason: pending?.reason || "authority_outbox_unavailable",
          delivered,
        };
      }
      const events = Array.isArray(pending.events) ? pending.events : [];
      if (!events.length) break;
      const invalid = findInvalidAuthorityEvent(events);
      if (invalid) {
        return {
          dispatched: false,
          reason: "invalid_authority_event_envelope",
          delivered,
          errors: invalid.errors,
        };
      }
      if (typeof publishEvent !== "function") {
        return { dispatched: false, reason: "authority_event_transport_unavailable", delivered };
      }
      const attempt = await bot.recordAuthorityEventAttempts({
        ...identity,
        consumerId,
        eventIds: events.map((item) => clean(item.eventId)),
      });
      if (!attempt?.recorded) {
        return {
          dispatched: false,
          reason: attempt?.reason || "authority_event_attempt_failed",
          delivered,
        };
      }
      const { acknowledgements, sendFailed } = await publishAuthorityEvents(events, publishEvent);
      if (acknowledgements.length) {
        const acknowledged = await bot.acknowledgeAuthorityEvents({
          ...identity,
          consumerId,
          acknowledgements,
        });
        if (!acknowledged?.acknowledged) {
          return {
            dispatched: false,
            reason: acknowledged?.reason || "authority_event_ack_failed",
            delivered,
          };
        }
        delivered += acknowledgements.length;
      }
      if (sendFailed) {
        return { dispatched: false, reason: "authority_event_send_failed", delivered };
      }
    }
    await compactAuthorityEventsIfDue(bot, identity, lastCompactAtBySession);
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
