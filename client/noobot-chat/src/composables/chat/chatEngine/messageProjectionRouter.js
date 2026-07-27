/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./turnProjectionStore.js";
import { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport.js";

export function routeMessageProjectionEvent(event, data, context) {
  const {
    applyWorkflowRuntimeEvent, botMessage, classifyRealtimeLog, locateSendingStartedMessageOnce,
    logSessionEvent, navigateOnFirstResponseOnce, sessionId, turnScopeId, upsertSubSessionEvent,
  } = context;
  if (shouldProjectSubSessionEvent(event, data || {})) {
    const result = typeof applyWorkflowRuntimeEvent === "function"
      ? applyWorkflowRuntimeEvent({ event: "workflow_message_event", data: data.event || {}, transportSequence: Number(data?.seq || 0) }, { source: "live" })
      : upsertSubSessionEvent?.(data.event?.eventType, data.event || {});
    logSessionEvent({
      category: "debug", level: "debug", debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.subSessionMessageReduced",
      sessionId: data.event?.sessionId || data.route?.subSessionId || "",
      dialogProcessId: data.event?.dialogProcessId || "", turnScopeId: data.event?.turnScopeId || "",
      data: {
        eventType: String(data.event?.eventType || ""), eventId: String(data.event?.eventId || ""),
        messageId: String(data.event?.messageId || ""), sequence: Number(data.event?.sequence || 0),
        applied: result?.applied === true, reason: String(result?.reason || ""),
        projectedMessageCount: Array.isArray(result?.session?.messages) ? result.session.messages.length : 0,
      },
    });
    return true;
  }
  if (event === "subagent_message_event") {
    logSessionEvent({
      category: "debug", level: "warn", debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.subSessionMessageRejected",
      sessionId: data?.event?.sessionId || data?.route?.subSessionId || "",
      dialogProcessId: data?.event?.dialogProcessId || "", turnScopeId: data?.event?.turnScopeId || "",
      data: {
        channelKind: String(data?.channelKind || ""), channelVersion: Number(data?.channelVersion || 0),
        routeScope: String(data?.route?.scope || ""), hasEvent: Boolean(data?.event),
        eventKeys: Object.keys(data?.event || {}).sort(), packetKeys: Object.keys(data || {}).sort(),
      },
    });
    return true;
  }
  if (shouldProjectMainSessionEvent(event, data || {})) {
    const messageEvent = data.event || {};
    const reduction = dispatchTurnEnvelope({ targetMessage: botMessage, envelope: messageEvent, classifyRealtimeLog, source: TURN_PROJECTION_SOURCE.NORMAL_LIVE });
    logSessionEvent({
      category: "transport", level: reduction.applied ? "debug" : "warn", event: "frontend.messageEvent.reduced",
      sessionId: messageEvent.sessionId || sessionId, dialogProcessId: messageEvent.dialogProcessId || "",
      turnScopeId: messageEvent.turnScopeId || turnScopeId,
      data: {
        source: "normal_live", eventId: messageEvent.eventId || "", eventType: messageEvent.eventType || "",
        messageId: messageEvent.messageId || "", sequence: messageEvent.sequence ?? null,
        result: reduction.result, errors: reduction.errors || [],
      },
    });
    if (reduction.applied) {
      navigateOnFirstResponseOnce?.();
      locateSendingStartedMessageOnce?.();
    }
    return true;
  }
  return false;
}

export function isIgnoredSubSessionEvent(event, data) {
  return data?.scope === "sub_session" || (typeof event === "string" && event.startsWith("subagent_"));
}
