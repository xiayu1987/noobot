/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./turnProjectionStore.js";
import { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport.js";
import {
  MESSAGE_EVENT_TYPE,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";

export function routeMessageProjectionEvent(event, data, context) {
  const {
    botMessage,
    classifyRealtimeLog,
    locateSendingStartedMessageOnce,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    logSessionEvent,
    navigateOnFirstResponseOnce,
    sessionId,
    turnScopeId,
    reduceSubSessionMessageEvent,
    materializeTurnPresentation,
  } = context;
  if (shouldProjectSubSessionEvent(event, data)) {
    reduceSubSessionMessageEvent?.(data);
    return true;
  }
  const messageEvent = data ?? {};
  const { identity = {}, payload = {}, ordering = {} } = messageEvent;
  const shouldProjectMain = shouldProjectMainSessionEvent(event, messageEvent);
  logSessionEvent({
    category: "transport",
    level: "debug",
    event: "frontend.messageEvent.routeEvaluated",
    sessionId: identity.sessionId || sessionId,
    dialogProcessId: payload.dialogProcessId || "",
    turnScopeId: identity.turnScopeId || turnScopeId,
    data: {
      channelEvent: String(event || ""),
      shouldProjectMain,
      eventId: identity.eventId || "",
      eventType: payload.eventType || "",
      messageId: identity.messageId || "",
      presentationMessageId: resolveMessageEventPresentationId(payload),
    },
  });
  if (shouldProjectMain) {
    if (payload.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
      const materialized = materializeTurnPresentation?.(messageEvent) || {
        applied: false,
        reason: "presentation_materializer_unavailable",
      };
      logSessionEvent({
        category: "transport",
        level: materialized.applied ? "debug" : "warn",
        event: "frontend.messageEvent.presentationMaterialized",
        sessionId: identity.sessionId || sessionId,
        dialogProcessId: payload.dialogProcessId || "",
        turnScopeId: identity.turnScopeId || turnScopeId,
        data: materialized,
      });
      if (!materialized.applied) return true;
    }
    const presentationMessageId = resolveMessageEventPresentationId(payload);
    const targetSessionId = String(identity.sessionId || sessionId || "").trim();
    const targetMessages =
      findCanonicalMessagesById?.(targetSessionId, presentationMessageId) ||
      [findCanonicalMessageById?.(targetSessionId, presentationMessageId)].filter(Boolean);
    // The send flow creates the visible assistant projection before replay
    // can materialize hidden tool records. Always include that canonical bot
    // object for the same presentation identity so live artifacts cannot land
    // exclusively on a non-rendered record.
    if (
      botMessage &&
      String(botMessage?.sessionId || botMessage?.session_id || targetSessionId).trim() ===
        targetSessionId &&
      String(botMessage?.turnScopeId || botMessage?.turn_scope_id || turnScopeId).trim() ===
        String(identity.turnScopeId || turnScopeId).trim() &&
      String(botMessage?.role || "assistant").trim() === "assistant" &&
      !targetMessages.includes(botMessage)
    )
      targetMessages.push(botMessage);
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
      category: "transport",
      level: targetMessage ? "debug" : "warn",
      event: "frontend.messageEvent.targetResolved",
      sessionId: targetSessionId,
      dialogProcessId: payload.dialogProcessId || "",
      turnScopeId: identity.turnScopeId || turnScopeId,
      data: {
        eventId: identity.eventId || "",
        eventType: payload.eventType || "",
        messageId: identity.messageId || "",
        presentationMessageId,
        targetSessionId,
        target: targetBefore,
      },
    });
    const reductions = targetMessages.map((message) =>
      dispatchTurnEnvelope({
        targetMessage: message,
        envelope: messageEvent,
        classifyRealtimeLog,
        source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      }),
    );
    const reduction = reductions.find((item) => item.applied) ||
      reductions[0] || { result: "target_missing", applied: false };
    logSessionEvent({
      category: "transport",
      level: reduction.applied ? "debug" : "warn",
      event: "frontend.messageEvent.reduced",
      sessionId: identity.sessionId || sessionId,
      dialogProcessId: payload.dialogProcessId || "",
      turnScopeId: identity.turnScopeId || turnScopeId,
      data: {
        source: "normal_live",
        eventId: identity.eventId || "",
        eventType: payload.eventType || "",
        messageId: identity.messageId || "",
        presentationMessageId,
        sequence: ordering.sequence ?? null,
        result: reduction.result,
        errors: reduction.errors || [],
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
  return shouldProjectSubSessionEvent(event, data);
}
