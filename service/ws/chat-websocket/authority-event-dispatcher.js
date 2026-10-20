/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateProtocolEvent } from "@noobot/event-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { text as clean, isFunction } from "@noobot/shared/value";

export const AUTHORITY_EVENT_CONSUMER = Object.freeze({
  WEBSOCKET: "service.websocket",
  CLI: "service.cli",
});

const KNOWN_CONSUMERS = new Set(Object.values(AUTHORITY_EVENT_CONSUMER));

function scopeKey(persistenceScope) {
  return persistenceScope === null ? "" : persistenceScope.scopeId;
}

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
  const now = Date.now();
  const accountingKey = `${identity.userId}\u0000${identity.sessionId}\u0000${scopeKey(
    identity.persistenceScope,
  )}`;
  const lastCompactAt = lastCompactAtBySession.get(accountingKey);
  if (
    lastCompactAt !== undefined &&
    now - lastCompactAt < TIME_THRESHOLDS.agent.authorityOutboxCompactIntervalMs
  ) {
    return;
  }
  await bot.session.compactAuthorityEvents({
    ...identity,
    retainDeliveredAfter: new Date(
      now - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
    ).toISOString(),
  });
  lastCompactAtBySession.set(accountingKey, now);
}

export function createAuthorityEventDispatcher({ resolveBot, sendEvent, consumerId }) {
  const normalizedConsumerId = clean(consumerId);
  if (!KNOWN_CONSUMERS.has(normalizedConsumerId)) {
    throw new Error(`authority event consumerId is required: ${normalizedConsumerId || "<empty>"}`);
  }
  if (!isFunction(resolveBot))
    throw new TypeError("authority event dispatcher requires resolveBot");
  if (!isFunction(sendEvent)) throw new TypeError("authority event dispatcher requires sendEvent");
  const inFlightByScope = new Map();
  const lastCompactAtBySession = new Map();

  const drainAuthorityEvents = async ({ userId, sessionId, persistenceScope }, publishEvent) => {
    const identity = {
      userId: clean(userId),
      sessionId: clean(sessionId),
      persistenceScope,
    };
    if (!identity.userId || !identity.sessionId) {
      return { dispatched: false, reason: "missing_session_identity", delivered: 0 };
    }
    const bot = resolveBot();
    let delivered = 0;
    const consumerId = normalizedConsumerId;
    while (true) {
      const pending = await bot.session.getPendingAuthorityEvents({
        ...identity,
        consumerId,
      });
      if (!pending.found) {
        return {
          dispatched: false,
          reason: pending.reason,
          delivered,
        };
      }
      const { events } = pending;
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
      const attempt = await bot.session.recordAuthorityEventAttempts({
        ...identity,
        consumerId,
        eventIds: events.map((item) => clean(item.eventId)),
      });
      if (!attempt.recorded) {
        return {
          dispatched: false,
          reason: attempt.reason,
          delivered,
        };
      }
      const { acknowledgements, sendFailed } = await publishAuthorityEvents(events, publishEvent);
      if (acknowledgements.length) {
        const acknowledged = await bot.session.acknowledgeAuthorityEvents({
          ...identity,
          consumerId,
          acknowledgements,
        });
        if (!acknowledged.acknowledged) {
          return {
            dispatched: false,
            reason: acknowledged.reason,
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

  return function dispatchAuthorityEvents(payload, publishEvent = sendEvent) {
    if (!isFunction(publishEvent)) {
      throw new TypeError("authority dispatch publishEvent must be a function");
    }
    const scopeValidation = validateSessionPersistenceScope(payload.persistenceScope);
    if (!scopeValidation.valid) {
      throw new TypeError(
        `invalid authority dispatch persistenceScope: ${scopeValidation.errors.join(",")}`,
      );
    }
    const key = [
      clean(payload.userId),
      clean(payload.sessionId),
      scopeKey(payload.persistenceScope),
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
          delivered += result.delivered;
          if (result.dispatched !== true) {
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
