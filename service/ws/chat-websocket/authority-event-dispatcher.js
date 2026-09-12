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
  // Compaction rewrites the outbox journal, so it is throttled per ordering
  // stream instead of running at the tail of every drain.
  const lastCompactAtByStream = new Map();

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
    const consumerId = "service.websocket";
    const watermarks = new Map();
    while (true) {
      const pending = await bot.getPendingAuthorityEvents({ ...identity, limit });
      if (!pending?.found) {
        return {
          dispatched: false,
          reason: pending?.reason || "authority_outbox_unavailable",
          delivered,
        };
      }
      const events = Array.isArray(pending.events) ? pending.events : [];
      if (!events.length) break;
      // Envelopes are validated up front so a malformed event never causes a
      // partially attempted batch.
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
      }
      if (typeof publishEvent !== "function") {
        return { dispatched: false, reason: "authority_event_transport_unavailable", delivered };
      }
      // One journal append records the attempt for the whole batch, keeping
      // at-least-once semantics: anything not acknowledged below is retried on
      // the next drain.
      const attempt = await bot.recordAuthorityEventAttempts({
        ...identity,
        eventIds: events.map((item) => clean(item.eventId)),
      });
      if (!attempt?.recorded) {
        return {
          dispatched: false,
          reason: attempt?.reason || "authority_event_attempt_failed",
          delivered,
        };
      }
      const acknowledgements = [];
      let sendFailed = false;
      for (const item of events) {
        const sent = await publishEvent(item.envelope.identity.eventType, item.envelope);
        if (sent !== true) {
          sendFailed = true;
          break;
        }
        acknowledgements.push({
          eventId: clean(item.eventId),
          orderingDomain: clean(item.envelope.ordering.domain),
          orderingScopeId: clean(item.envelope.ordering.scopeId),
          sequence: Number(item.envelope.ordering.sequence),
        });
      }
      // Acknowledge whatever actually reached the transport, even when the batch
      // stopped early, so successful sends are never re-delivered.
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
        for (const receipt of acknowledgements) {
          const streamKey = `${receipt.orderingDomain}\u0000${receipt.orderingScopeId}`;
          watermarks.set(streamKey, {
            orderingDomain: receipt.orderingDomain,
            orderingScopeId: receipt.orderingScopeId,
            deliveredThroughSequence: Math.max(
              receipt.sequence,
              watermarks.get(streamKey)?.deliveredThroughSequence || 0,
            ),
          });
        }
      }
      if (sendFailed) {
        return { dispatched: false, reason: "authority_event_send_failed", delivered };
      }
    }
    if (watermarks.size && typeof bot.compactAuthorityEvents === "function") {
      const retainDeliveredAfter = new Date(
        Date.now() - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
      ).toISOString();
      const now = Date.now();
      for (const [streamKey, watermark] of watermarks) {
        // Accounting key carries the session identity because one dispatcher
        // instance serves every session, while streamKey alone is only unique
        // within a session.
        const accountingKey = `${identity.userId}\u0000${identity.sessionId}\u0000${streamKey}`;
        const lastCompactAt = lastCompactAtByStream.get(accountingKey);
        if (
          lastCompactAt !== undefined &&
          now - lastCompactAt < TIME_THRESHOLDS.agent.authorityOutboxCompactIntervalMs
        ) {
          continue;
        }
        await bot.compactAuthorityEvents({
          ...identity,
          consumerId,
          ...watermark,
          retainDeliveredAfter,
        });
        lastCompactAtByStream.set(accountingKey, now);
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
