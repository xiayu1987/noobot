/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertAuthorityOutboxRequest,
  assertAuthorityOutboxAcknowledgementResult,
} from "@noobot/event-protocol/outbox";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { isFunction } from "@noobot/shared/value";
import { withAuthorityOutboxDelivery } from "./authority-outbox-maintenance.js";

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
    const result = assertAuthorityOutboxAcknowledgementResult(
      await session.acknowledgeAuthorityEvents(request),
    );
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

async function dispatchAuthorityBatch({
  session,
  identity,
  consumerId,
  events,
  publishEvent,
  onAcknowledged,
  entry,
}) {
  const { acknowledgements, sendFailed, publishFailure } = await publishAuthorityEvents(
    events,
    publishEvent,
  );
  let drained;
  if (acknowledgements.length) {
    entry.dirty = false;
    const acknowledged = await acknowledgePublishedEvents(
      session,
      { ...identity, consumerId, acknowledgements },
      publishFailure,
    );
    if (!acknowledged.acknowledged)
      return { dispatched: false, reason: acknowledged.reason, delivered: 0 };
    drained = acknowledged.drained;
    onAcknowledged();
  }
  if (publishFailure) throw publishFailure.error;
  const delivered = acknowledgements.length;
  if (sendFailed) return { dispatched: false, reason: "authority_event_send_failed", delivered };
  return { dispatched: true, delivered, drained };
}

export function createAuthorityEventDispatcher({
  runNewOperation,
  resolveBot,
  sendEvent,
  consumerId,
}) {
  const normalizedConsumerId = consumerId;
  if (!KNOWN_CONSUMERS.has(normalizedConsumerId)) {
    throw new Error(`authority event consumerId is required: ${normalizedConsumerId || "<empty>"}`);
  }
  if (!isFunction(resolveBot))
    throw new TypeError("authority event dispatcher requires resolveBot");
  if (!isFunction(runNewOperation))
    throw new TypeError("authority event dispatcher requires runNewOperation");
  if (!isFunction(sendEvent)) throw new TypeError("authority event dispatcher requires sendEvent");
  const inFlightByScope = new Map();

  const drainAuthorityEvents = async (
    { userId, sessionId, persistenceScope },
    publishEvent,
    onAcknowledged,
    entry,
    finish,
  ) => {
    const identity = {
      userId,
      sessionId,
      persistenceScope,
    };
    const bot = resolveBot();
    let delivered = 0;
    const consumerId = normalizedConsumerId;
    while (true) {
      entry.dirty = false;
      const pending = await bot.session.prepareAuthorityEventDelivery({
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
      if (!events.length) {
        if (pending.hasMore === true || entry.dirty) continue;

        finish();
        break;
      }
      const result = await dispatchAuthorityBatch({
        session: bot.session,
        identity,
        consumerId,
        events,
        publishEvent,
        onAcknowledged,
        entry,
      });
      delivered += result.delivered;
      if (!result.dispatched) return { ...result, delivered };
      if (result.drained && !entry.dirty) {
        finish();
        break;
      }
    }
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
    assertAuthorityOutboxRequest({ ...payload, consumerId }, "prepareDelivery");
    const key = [payload.userId, payload.sessionId, scopeKey(payload.persistenceScope)].join("::");
    const active = inFlightByScope.get(key);
    if (active) {
      active.dirty = true;
      return active.promise;
    }

    const entry = { dirty: false, promise: null };
    const finish = () => {
      if (inFlightByScope.get(key) === entry) inFlightByScope.delete(key);
    };
    entry.promise = (async () => {
      try {
        return await withAuthorityOutboxDelivery(
          { runNewOperation, resolveBot },
          payload,
          (onAcknowledged) =>
            drainAuthorityEvents(payload, publishEvent, onAcknowledged, entry, finish),
        );
      } finally {
        finish();
      }
    })();
    inFlightByScope.set(key, entry);
    return entry.promise;
  };
}
