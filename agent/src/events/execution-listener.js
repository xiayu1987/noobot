/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
import { classifyExecutionEvent } from "../observability/event-log/log-normalizer.js";
import { projectExecutionTransportPayload } from "./transport-payload.js";
import { AGENT_RUN_EVENTS } from "./run-event.js";

function enrichEventData(rawData = {}, defaults = {}) {
  const eventData = rawData && typeof rawData === "object" ? rawData : {};
  return {
    ...eventData,
    dialogProcessId: String(eventData?.dialogProcessId || defaults.dialogProcessId || "").trim(),
    sessionId: String(eventData?.sessionId || defaults.sessionId || ""),
    turnScopeId: String(eventData?.turnScopeId || defaults.turnScopeId || ""),
    parentSessionId: normalizeParentSessionId(
      eventData?.parentSessionId || defaults.parentSessionId,
    ),
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
  const deliveryFailures = [];

  const appendExecutionLog = (record) => {
    const data = enrichEventData(record?.data, defaults);
    const canonicalRecord = {
      ...record,
      userId,
      sessionId: data.sessionId,
      parentSessionId: data.parentSessionId,
      dialogProcessId: data.dialogProcessId,
      turnScopeId: data.turnScopeId,
      data,
    };
    persistenceTail = persistenceTail
      .catch(() => {})
      .then(() => sessionManager?.appendExecutionLog?.(canonicalRecord))
      .catch(() => {});
    return persistenceTail;
  };

  const summarizeDelivery = (event, data = {}) => ({
    sourceEvent: event,
    eventId: String(data?.envelope?.identity?.eventId || "").trim(),
    eventType: String(data?.envelope?.identity?.eventType || event || "").trim(),
    sessionId: String(data?.envelope?.identity?.sessionId || data?.sessionId || sessionId || "").trim(),
    parentSessionId: String(data?.parentSessionId || parentSessionId || "").trim(),
    dialogProcessId: String(data?.dialogProcessId || dialogProcessId || "").trim(),
    turnScopeId: String(data?.envelope?.identity?.turnScopeId || data?.turnScopeId || turnScopeId || "").trim(),
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
      if (shouldDiagnose) {
        appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event: "execution_upstream_forward_started",
          category: "debug",
          type: "execution_upstream_forward_started",
          data: diagnostic,
          ts: new Date().toISOString(),
        });
      }
      try {
        const result = await upstream?.onEvent?.({ event, data: transportData, ts });
        if (result === false) {
          const error = new Error("upstream rejected event delivery");
          error.code = "EVENT_UPSTREAM_DELIVERY_REJECTED";
          throw error;
        }
        if (shouldDiagnose) {
          appendExecutionLog({
            userId,
            sessionId,
            parentSessionId,
            dialogProcessId,
            event: "execution_upstream_forward_completed",
            category: "debug",
            type: "execution_upstream_forward_completed",
            data: {
              ...diagnostic,
              result: result === true ? true : result === false ? false : "completed",
            },
            ts: new Date().toISOString(),
          });
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
    flushPersistence: () => persistenceTail,
    flushDelivery: async () => {
      await deliveryTail;
      if (deliveryFailures.length > 0) {
        const error = new Error(`event upstream delivery failed: ${deliveryFailures[0].error}`);
        error.code = "EVENT_UPSTREAM_DELIVERY_FAILED";
        error.failures = [...deliveryFailures];
        throw error;
      }
    },
    forwardEvent,
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();

      const { category, type } = classifyExecutionEvent(event);
      try {
        appendExecutionLog({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event,
          category,
          type,
          data,
          ts,
        });
      } catch {}

      // Execution diagnostics are persisted locally and never become client
      // facts. Only the explicit private run contract may cross this boundary.
      if (!AGENT_RUN_EVENTS.has(event)) return persistenceTail;
      return forwardEvent({ event, data, ts });
    },
  };
}
