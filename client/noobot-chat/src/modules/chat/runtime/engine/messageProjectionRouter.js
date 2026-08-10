/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./turnProjectionStore.js";
import { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport.js";
import { resolveMessageEventPresentationId } from "@noobot/event-protocol/message-event";

export function routeMessageProjectionEvent(event, data, context) {
  const {
    botMessage, classifyRealtimeLog, locateSendingStartedMessageOnce,
    findCanonicalMessageById, findCanonicalMessagesById, logSessionEvent, navigateOnFirstResponseOnce, sessionId, turnScopeId,
  } = context;
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
  const messageEvent = data?.event || {};
  const shouldProjectMain = shouldProjectMainSessionEvent(event, data || {});
  logSessionEvent({
    category: "transport", level: "debug",
    event: "frontend.messageEvent.routeEvaluated",
    sessionId: messageEvent.sessionId || sessionId,
    dialogProcessId: messageEvent.dialogProcessId || "",
    turnScopeId: messageEvent.turnScopeId || turnScopeId,
    data: {
      channelEvent: String(event || ""), shouldProjectMain,
      routeScope: String(data?.route?.scope || ""),
      eventId: messageEvent.eventId || "", eventType: messageEvent.eventType || "",
      messageId: messageEvent.messageId || "",
      presentationMessageId: resolveMessageEventPresentationId(messageEvent),
    },
  });
  if (shouldProjectMain) {
    const presentationMessageId = resolveMessageEventPresentationId(messageEvent);
    const targetSessionId = String(messageEvent.sessionId || sessionId || "").trim();
    const targetMessages = findCanonicalMessagesById?.(targetSessionId, presentationMessageId)
      || [findCanonicalMessageById?.(targetSessionId, presentationMessageId)].filter(Boolean);
    // The send flow creates the visible assistant projection before replay
    // can materialize hidden tool records. Always include that canonical bot
    // object for the same presentation identity so live artifacts cannot land
    // exclusively on a non-rendered record.
    if (
      botMessage &&
      String(botMessage?.sessionId || botMessage?.session_id || targetSessionId).trim() === targetSessionId &&
      String(botMessage?.turnScopeId || botMessage?.turn_scope_id || turnScopeId).trim() ===
        String(messageEvent.turnScopeId || turnScopeId).trim() &&
      String(botMessage?.role || "assistant").trim() === "assistant" &&
      !targetMessages.includes(botMessage)
    ) targetMessages.push(botMessage);
    const targetMessage = targetMessages[targetMessages.length - 1] || null;
    const targetBefore = {
      found: Boolean(targetMessage),
      id: String(targetMessage?.id || ""),
      messageId: String(targetMessage?.messageId || ""),
      role: String(targetMessage?.role || ""),
      type: String(targetMessage?.type || ""),
      phase: String(targetMessage?.pluginMeta?.phase || ""),
      contentLength: String(targetMessage?.content || "").length,
    };
    logSessionEvent({
      category: "transport", level: targetMessage ? "debug" : "warn",
      event: "frontend.messageEvent.targetResolved",
      sessionId: targetSessionId, dialogProcessId: messageEvent.dialogProcessId || "",
      turnScopeId: messageEvent.turnScopeId || turnScopeId,
      data: {
        eventId: messageEvent.eventId || "", eventType: messageEvent.eventType || "",
        messageId: messageEvent.messageId || "", presentationMessageId,
        targetSessionId, target: targetBefore,
      },
    });
    const reductions = targetMessages.map((message) => dispatchTurnEnvelope({
      targetMessage: message,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    }));
    const reduction = reductions.find((item) => item.applied) || reductions[0] || { result: "target_missing", applied: false };
    logSessionEvent({
      category: "transport", level: reduction.applied ? "debug" : "warn", event: "frontend.messageEvent.reduced",
      sessionId: messageEvent.sessionId || sessionId, dialogProcessId: messageEvent.dialogProcessId || "",
      turnScopeId: messageEvent.turnScopeId || turnScopeId,
      data: {
        source: "normal_live", eventId: messageEvent.eventId || "", eventType: messageEvent.eventType || "",
        messageId: messageEvent.messageId || "", presentationMessageId,
        sequence: messageEvent.sequence ?? null,
        result: reduction.result, errors: reduction.errors || [],
        targetBefore,
        targetAfter: {
          contentLength: String(targetMessage?.content || "").length,
          type: String(targetMessage?.type || ""),
          phase: String(targetMessage?.pluginMeta?.phase || ""),
          lastSequence: Number(targetMessage?.messageEventState?.lastSequence || 0),
        },
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
