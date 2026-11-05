/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertAuthorityOutboxRequest } from "@noobot/event-protocol/outbox";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { isFunction } from "@noobot/shared/value";
import { readServiceClockMs } from "./service-clock.js";

export const AUTHORITY_EVENT_CONSUMER = Object.freeze({
  WEBSOCKET: "service.websocket",
  CLI: "service.cli",
});

const KNOWN_CONSUMERS = new Set(Object.values(AUTHORITY_EVENT_CONSUMER));

function scopeKey(persistenceScope) {
  return persistenceScope === null ? "" : persistenceScope.scopeId;
}

async function publishAuthorityEvents(events, publishEvent) {
  const acknowledgements = [];
  for (const item of events) {
    let sent;
    try {
      sent = await publishEvent(item.envelope.identity.eventType, item.envelope);
    } catch (error) {
      return { acknowledgements, sendFailed: true, publishFailure: { error } };
    }
    if (sent !== true) return { acknowledgements, sendFailed: true };
    acknowledgements.push({
      eventId: item.eventId,
      orderingDomain: item.envelope.ordering.domain,
      orderingScopeId: item.envelope.ordering.scopeId,
      sequence: item.envelope.ordering.sequence,
    });
  }
  return { acknowledgements, sendFailed: false };
}

async function acknowledgePublishedEvents(session, request, publishFailure) {
  try {
    const result = await session.acknowledgeAuthorityEvents(request);
    if (!result.acknowledged && publishFailure) throw new Error(result.reason);
    return result;
  } catch (error) {
    if (!publishFailure) throw error;
    throw new AggregateError(
      [publishFailure.error, error],
      "authority event publishing and acknowledgement failed",
    );
  }
}

async function dispatchAuthorityBatch({ session, identity, consumerId, events, publishEvent }) {
  const attempt = await session.recordAuthorityEventAttempts({
    ...identity,
    consumerId,
    eventIds: events.map((item) => item.eventId),
  });
  if (!attempt.recorded) return { dispatched: false, reason: attempt.reason, delivered: 0 };
  const { acknowledgements, sendFailed, publishFailure } = await publishAuthorityEvents(
    events,
    publishEvent,
  );
  if (acknowledgements.length) {
    const acknowledged = await acknowledgePublishedEvents(
      session,
      { ...identity, consumerId, acknowledgements },
      publishFailure,
    );
    if (!acknowledged.acknowledged)
      return { dispatched: false, reason: acknowledged.reason, delivered: 0 };
  }
  if (publishFailure) throw publishFailure.error;
  const delivered = acknowledgements.length;
  if (sendFailed) return { dispatched: false, reason: "authority_event_send_failed", delivered };
  return { dispatched: true, delivered };
}

async function drainDirtyScope(entry, drain) {
  let delivered = 0;
  do {
    entry.dirty = false;
    const result = await drain();
    delivered += result.delivered;
    if (result.dispatched !== true) return { ...result, delivered };
  } while (entry.dirty);
  return { dispatched: true, delivered };
}

async function compactAuthorityEventsIfDue(bot, identity, lastCompactAtBySession) {
  const now = readServiceClockMs(bot);
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
  const normalizedConsumerId = consumerId;
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
      userId,
      sessionId,
      persistenceScope,
    };
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
      const result = await dispatchAuthorityBatch({
        session: bot.session,
        identity,
        consumerId,
        events,
        publishEvent,
      });
      delivered += result.delivered;
      if (!result.dispatched) return { ...result, delivered };
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
    assertAuthorityOutboxRequest({ ...payload, consumerId }, "pending");
    const key = [payload.userId, payload.sessionId, scopeKey(payload.persistenceScope)].join("::");
    const active = inFlightByScope.get(key);
    if (active) {
      active.dirty = true;
      return active.promise;
    }

    const entry = { dirty: false, promise: null };
    entry.promise = (async () => {
      try {
        return await drainDirtyScope(entry, () => drainAuthorityEvents(payload, publishEvent));
      } finally {
        if (inFlightByScope.get(key) === entry) inFlightByScope.delete(key);
      }
    })();
    inFlightByScope.set(key, entry);
    return entry.promise;
  };
}
