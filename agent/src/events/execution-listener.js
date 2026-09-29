/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeDialogProcessId } from "@noobot/session-protocol";
import { classifyExecutionEvent } from "../observability/event-log/log-normalizer.js";
import {
  projectExecutionRouteIdentity,
  projectExecutionTransportPayload,
} from "./transport-payload.js";
import { AGENT_RUN_EVENT, AGENT_RUN_EVENTS } from "./run-event.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";

function projectExecutionLogRecord(event = "", data = {}) {
  if (event !== AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED) return { event, data };
  const envelope = data?.envelope;
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) {
    return { event, data };
  }
  return {
    event: envelope.payload.eventType,
    data: {
      ...envelope.payload,
      eventId: envelope.identity.eventId,
      sessionId: envelope.identity.sessionId,
      turnScopeId: envelope.identity.turnScopeId,
      messageId: envelope.identity.messageId,
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
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  turnScopeId = "",
  upstream = null,
}) {
  const dialogProcessId = normalizeDialogProcessId(upstream?.dialogProcessId);
  const defaults = { dialogProcessId, sessionId, parentSessionId, turnScopeId };
  let persistenceTail = Promise.resolve();
  let deliveryTail = Promise.resolve();
  const persistenceFailures = [];
  const deliveryFailures = [];

  const appendExecutionLog = (record) => {
    const data = projectExecutionRouteIdentity(record?.data, defaults);
    const canonicalRecord = {
      ...record,
      userId,
      sessionId: data.sessionId,
      parentSessionId: data.parentSessionId,
      dialogProcessId: data.dialogProcessId,
      turnScopeId: data.turnScopeId,
      data,
    };
    persistenceTail = persistenceTail.then(async () => {
      try {
        await sessionManager?.appendExecutionLog?.(canonicalRecord);
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

  const summarizeDelivery = (event, data = {}) => ({
    sourceEvent: event,
    eventId: String(data?.envelope?.identity?.eventId || "").trim(),
    eventType: String(data?.envelope?.identity?.eventType || event || "").trim(),
    sessionId: String(
      data?.envelope?.identity?.sessionId || data?.sessionId || sessionId || "",
    ).trim(),
    parentSessionId: String(data?.parentSessionId || parentSessionId || "").trim(),
    dialogProcessId: String(data?.dialogProcessId || dialogProcessId || "").trim(),
    turnScopeId: String(
      data?.envelope?.identity?.turnScopeId || data?.turnScopeId || turnScopeId || "",
    ).trim(),
    messageId: String(data?.envelope?.identity?.messageId || "").trim(),
    presentationMessageId: String(data?.presentationMessageId || "").trim(),
    sequence: Number(data?.envelope?.ordering?.sequence || 0),
    contentLength: String(data?.text || data?.content || "").length,
    attachmentCount: Array.isArray(data?.attachments) ? data.attachments.length : 0,
    transferEnvelopeCount: Array.isArray(data?.transferEnvelopes)
      ? data.transferEnvelopes.length
      : 0,
  });

  const forwardUpstream = ({ event, data, ts }) => {
    const transportData = projectExecutionTransportPayload({ event, data, route: defaults });
    const diagnostic = summarizeDelivery(event, transportData);
    const shouldDiagnose = Boolean(diagnostic.eventId || diagnostic.messageId);
    const task = deliveryTail.then(async () => {
      try {
        const result = await upstream?.onEvent?.({ event, data: transportData, ts });
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
            userId,
            sessionId,
            parentSessionId,
            dialogProcessId,
            event: "execution_upstream_forward_failed",
            category: "system",
            type: "execution_upstream_forward_failed",
            data: failure,
            ts: new Date().toISOString(),
          });
        }
        return false;
      }
    });
    deliveryTail = task;
    return task;
  };

  const forwardEvent = (evt = {}) =>
    forwardUpstream({
      event: evt?.event || "",
      data: evt?.data || {},
      ts: evt?.ts || new Date().toISOString(),
    });

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

      // Transient message events are live-only by protocol: forward them, never persist them
      // into the execution log (the durable activity / final content event is logged instead).
      if (!isTransientMessageEvent(data?.envelope)) {
        const executionRecord = projectExecutionLogRecord(event, data);
        const { category, type } = classifyExecutionEvent(executionRecord.event);
        appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event: executionRecord.event,
          category,
          type,
          data: executionRecord.data,
          ts,
        });
      }

      if (!AGENT_RUN_EVENTS.has(event)) return persistenceTail;
      return forwardEvent({ event, data, ts });
    },
  };
}
