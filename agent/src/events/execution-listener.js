/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { classifyExecutionEvent } from "../observability/event-log/log-normalizer.js";
import {
  omitExecutionRouteIdentity,
  projectExecutionTransportPayload,
  requireExecutionRouteIdentity,
} from "./transport-payload.js";
import { AGENT_RUN_EVENT, AGENT_RUN_EVENTS } from "./run-event.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";
import { text, isFunction } from "@noobot/shared/value";

function projectExecutionLogRecord(event = "", data = {}) {
  if (event !== AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED) return { event, data };
  const envelope = data?.envelope;
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid committed authority event: ${validation.errors.join(",")}`);
  }
  if (validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) return { event, data };
  if (!Number.isFinite(data.persistDurationMs) || data.persistDurationMs < 0) {
    throw new TypeError("committed message event requires persistDurationMs");
  }
  return {
    event: envelope.payload.eventType,
    data: {
      ...envelope.payload,
      persistDurationMs: data.persistDurationMs,
      eventId: envelope.identity.eventId,
      executionId: envelope.identity.executionId,
      sequence: envelope.ordering.sequence,
      sequenceDomain: envelope.ordering.domain,
      sequenceScopeId: envelope.ordering.scopeId,
      timestamp: envelope.occurredAt,
      authority: "authoritative",
    },
  };
}

export function createExecutionEventListener({
  sessionManager,
  userId,
  sessionId,
  parentSessionId,
  turnScopeId,
  dialogProcessId,
  persistenceScope,
  upstream = null,
}) {
  if (!isFunction(sessionManager?.appendExecutionLog)) {
    throw new TypeError("sessionManager.appendExecutionLog is required");
  }
  if (upstream !== null && !isFunction(upstream.onEvent)) {
    throw new TypeError("execution event upstream requires an onEvent port");
  }

  if (persistenceScope === undefined) {
    throw new TypeError("execution event listener requires an explicit persistenceScope");
  }
  const route = requireExecutionRouteIdentity({
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
  });
  let persistenceTail = Promise.resolve();
  let deliveryTail = Promise.resolve();
  const persistenceFailures = [];
  const deliveryFailures = [];
  const deliveryTiming =
    upstream && isFunction(upstream.onDeliveryTiming) ? { queueWaitMs: [], runMs: [] } : null;

  const summarizeTiming = (values = []) => {
    if (!values.length) return { n: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (ratio) =>
      Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))].toFixed(2));
    return {
      n: sorted.length,
      p50: pick(0.5),
      p90: pick(0.9),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
      totalMs: Number(sorted.reduce((sum, value) => sum + value, 0).toFixed(1)),
    };
  };

  const appendExecutionLog = (record) => {
    const canonicalRecord = {
      ...record,
      userId: route.userId,
      sessionId: route.sessionId,
      dialogProcessId: route.dialogProcessId,
      turnScopeId: route.turnScopeId,
      data: omitExecutionRouteIdentity(record?.data),
      persistenceScope,
    };
    persistenceTail = persistenceTail.then(async () => {
      try {
        await sessionManager.appendExecutionLog(canonicalRecord);
      } catch (error) {
        persistenceFailures.push({
          event: canonicalRecord.event,
          error: error?.message || String(error || ""),
          cause: error,
        });
      }
    });
    return persistenceTail;
  };

  const summarizeDelivery = (event, data, deliveryRoute) => ({
    sourceEvent: event,
    eventId: text(data?.envelope?.identity?.eventId),
    eventType: text(data?.envelope?.identity?.eventType || event),
    route: {
      sessionId: deliveryRoute.sessionId,
      parentSessionId: deliveryRoute.parentSessionId,
      dialogProcessId: deliveryRoute.dialogProcessId,
      turnScopeId: deliveryRoute.turnScopeId,
    },
    presentationMessageId: text(data?.presentationMessageId),
    sequence: Number(data?.envelope?.ordering?.sequence || 0),
    contentLength: String(data?.text || data?.content || "").length,
    attachmentCount: Array.isArray(data?.attachments) ? data.attachments.length : 0,
    transferEnvelopeCount: Array.isArray(data?.transferEnvelopes)
      ? data.transferEnvelopes.length
      : 0,
  });

  const forwardUpstream = ({ event, data, ts, route: deliveryRoute }) => {
    const transportData = projectExecutionTransportPayload({ data, route: deliveryRoute });
    const diagnostic = summarizeDelivery(event, transportData, deliveryRoute);
    const shouldDiagnose = Boolean(diagnostic.eventId || diagnostic.presentationMessageId);
    const enqueuedAt = deliveryTiming ? performance.now() : 0;
    const task = deliveryTail.then(async () => {
      const startedAt = deliveryTiming ? performance.now() : 0;
      deliveryTiming?.queueWaitMs.push(startedAt - enqueuedAt);
      try {
        if (!upstream) return undefined;
        const result = await upstream.onEvent({ event, data: transportData, ts });
        if (result === false) {
          const error = new Error("upstream rejected event delivery");
          error.code = "EVENT_UPSTREAM_DELIVERY_REJECTED";
          throw error;
        }
        return result;
      } catch (error) {
        const failure = { ...diagnostic, error: error?.message || String(error || "") };
        deliveryFailures.push(failure);
        if (shouldDiagnose) {
          appendExecutionLog({
            event: "execution_upstream_forward_failed",
            category: "system",
            type: "execution_upstream_forward_failed",
            data: failure,
            ts: new Date().toISOString(),
          });
        }
        return false;
      } finally {
        deliveryTiming?.runMs.push(performance.now() - startedAt);
      }
    });
    deliveryTail = task;
    return task;
  };

  const forwardEvent = (evt = {}) => {
    return forwardUpstream({
      event: evt?.event || "",
      data: evt?.data || {},
      ts: evt?.ts || new Date().toISOString(),
      route: requireExecutionRouteIdentity(evt?.route),
    });
  };

  return {
    flush: async () => {
      let delivery;
      let persistence;
      do {
        delivery = deliveryTail;
        await delivery;
        persistence = persistenceTail;
        await persistence;
      } while (delivery !== deliveryTail || persistence !== persistenceTail);

      if (deliveryTiming && deliveryTiming.queueWaitMs.length > 0) {
        const summary = {
          sessionId: route.sessionId,
          turnScopeId: route.turnScopeId,
          dialogProcessId: route.dialogProcessId,
          queueWaitMs: summarizeTiming(deliveryTiming.queueWaitMs),
          runMs: summarizeTiming(deliveryTiming.runMs),
        };
        deliveryTiming.queueWaitMs = [];
        deliveryTiming.runMs = [];
        upstream.onDeliveryTiming(summary);
      }

      const errors = [];
      if (deliveryFailures.length > 0) {
        const error = new Error(`event upstream delivery failed: ${deliveryFailures[0].error}`);
        error.code = "EVENT_UPSTREAM_DELIVERY_FAILED";
        error.failures = [...deliveryFailures];
        errors.push(error);
      }
      if (persistenceFailures.length > 0) {
        const error = new Error(
          `execution log persistence failed: ${persistenceFailures[0].error}`,
          { cause: persistenceFailures[0].cause },
        );
        error.code = "EXECUTION_LOG_PERSISTENCE_FAILED";
        error.failures = persistenceFailures.map(({ cause: _cause, ...failure }) => failure);
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        const error = new AggregateError(errors, "execution event delivery and persistence failed");
        error.code = "EXECUTION_EVENT_FLUSH_FAILED";
        throw error;
      }
    },
    forwardEvent,
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();

      if (!isTransientMessageEvent(data?.envelope)) {
        const executionRecord = projectExecutionLogRecord(event, data);
        const { category, type } = classifyExecutionEvent(executionRecord.event);
        appendExecutionLog({
          event: executionRecord.event,
          category,
          type,
          data: executionRecord.data,
          ts,
        });
      }

      if (!AGENT_RUN_EVENTS.has(event)) return persistenceTail;
      return forwardUpstream({ event, data, ts, route });
    },
  };
}
