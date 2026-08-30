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

function logRouteEvaluation(event, messageEvent, shouldProjectMain, context) {
  const { identity = {}, payload = {} } = messageEvent;
  context.logSessionEvent({
    category: "transport",
    level: "debug",
    event: "frontend.messageEvent.routeEvaluated",
    sessionId: identity.sessionId || context.sessionId,
    dialogProcessId: payload.dialogProcessId || "",
    turnScopeId: identity.turnScopeId || context.turnScopeId,
    data: {
      channelEvent: String(event || ""),
      shouldProjectMain,
      eventId: identity.eventId || "",
      eventType: payload.eventType || "",
      messageId: identity.messageId || "",
      presentationMessageId: resolveMessageEventPresentationId(payload),
    },
  });
}

function materializeCommittedPresentation(messageEvent, context) {
  const { identity = {}, payload = {} } = messageEvent;
  if (payload.eventType !== MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) return true;
  const materialized = context.materializeTurnPresentation?.(messageEvent) || {
    applied: false,
    reason: "presentation_materializer_unavailable",
  };
  context.logSessionEvent({
    category: "transport",
    level: materialized.applied ? "debug" : "warn",
    event: "frontend.messageEvent.presentationMaterialized",
    sessionId: identity.sessionId || context.sessionId,
    dialogProcessId: payload.dialogProcessId || "",
    turnScopeId: identity.turnScopeId || context.turnScopeId,
    data: materialized,
  });
  return materialized.applied;
}

function addLiveBotProjection(targetMessages, targetSessionId, identity, context) {
  const botMessage = context.botMessage;
  if (!botMessage) return;
  const sameSession =
    String(botMessage.sessionId || botMessage.session_id || targetSessionId).trim() ===
    targetSessionId;
  const sameTurn =
    String(botMessage.turnScopeId || botMessage.turn_scope_id || context.turnScopeId).trim() ===
    String(identity.turnScopeId || context.turnScopeId).trim();
  const isAssistant = String(botMessage.role || "assistant").trim() === "assistant";
  if (sameSession && sameTurn && isAssistant && !targetMessages.includes(botMessage)) {
    targetMessages.push(botMessage);
  }
}

function resolveProjectionTargets(messageEvent, context) {
  const { identity = {}, payload = {} } = messageEvent;
  const presentationMessageId = resolveMessageEventPresentationId(payload);
  const targetSessionId = String(identity.sessionId || context.sessionId || "").trim();
  const targetMessages =
    context.findCanonicalMessagesById?.(targetSessionId, presentationMessageId) ||
    [context.findCanonicalMessageById?.(targetSessionId, presentationMessageId)].filter(Boolean);
  // The send flow creates the visible assistant projection before replay can materialize hidden
  // tool records. Include that canonical object so live artifacts reach the rendered entity.
  addLiveBotProjection(targetMessages, targetSessionId, identity, context);
  return { presentationMessageId, targetSessionId, targetMessages };
}

function describeProjectionTarget(targetMessage) {
  return {
    found: Boolean(targetMessage),
    id: String(targetMessage?.id || ""),
    messageId: String(targetMessage?.messageId || ""),
    role: String(targetMessage?.role || ""),
    type: String(targetMessage?.type || ""),
    phase: String(targetMessage?.pluginMeta?.phase || ""),
    contentLength: String(targetMessage?.content || "").length,
  };
}

function reduceProjectionTargets(messageEvent, targetMessages, context) {
  const reductions = targetMessages.map((message) =>
    dispatchTurnEnvelope({
      targetMessage: message,
      envelope: messageEvent,
      classifyRealtimeLog: context.classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    }),
  );
  return (
    reductions.find((item) => item.applied) ||
    reductions[0] || { result: "target_missing", applied: false }
  );
}

function projectionEventFields(identity, payload, context) {
  return {
    sessionId: identity.sessionId || context.sessionId,
    dialogProcessId: payload.dialogProcessId || "",
    turnScopeId: identity.turnScopeId || context.turnScopeId,
    eventId: identity.eventId || "",
    eventType: payload.eventType || "",
    messageId: identity.messageId || "",
  };
}

function logProjectionReduction({
  messageEvent,
  presentationMessageId,
  reduction,
  targetMessage,
  targetBefore,
  context,
}) {
  const { identity = {}, payload = {}, ordering = {} } = messageEvent;
  const fields = projectionEventFields(identity, payload, context);
  context.logSessionEvent({
    category: "transport",
    level: reduction.applied ? "debug" : "warn",
    event: "frontend.messageEvent.reduced",
    sessionId: fields.sessionId,
    dialogProcessId: fields.dialogProcessId,
    turnScopeId: fields.turnScopeId,
    data: {
      source: "normal_live",
      eventId: fields.eventId,
      eventType: fields.eventType,
      messageId: fields.messageId,
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
}

function projectMainSessionEvent(messageEvent, context) {
  const { identity = {}, payload = {} } = messageEvent;
  if (!materializeCommittedPresentation(messageEvent, context)) return true;
  const { presentationMessageId, targetSessionId, targetMessages } = resolveProjectionTargets(
    messageEvent,
    context,
  );
  const targetMessage = targetMessages[targetMessages.length - 1] || null;
  const targetBefore = describeProjectionTarget(targetMessage);
  const fields = projectionEventFields(identity, payload, context);
  context.logSessionEvent({
    category: "transport",
    level: targetMessage ? "debug" : "warn",
    event: "frontend.messageEvent.targetResolved",
    sessionId: targetSessionId,
    dialogProcessId: fields.dialogProcessId,
    turnScopeId: fields.turnScopeId,
    data: {
      eventId: fields.eventId,
      eventType: fields.eventType,
      messageId: fields.messageId,
      presentationMessageId,
      targetSessionId,
      target: targetBefore,
    },
  });
  const reduction = reduceProjectionTargets(messageEvent, targetMessages, context);
  logProjectionReduction({
    messageEvent,
    presentationMessageId,
    reduction,
    targetMessage,
    targetBefore,
    context,
  });
  if (reduction.applied) {
    context.navigateOnFirstResponseOnce?.();
    context.locateSendingStartedMessageOnce?.();
  }
  return true;
}

export function routeMessageProjectionEvent(event, data, context) {
  const { reduceSubSessionMessageEvent } = context;
  if (shouldProjectSubSessionEvent(event, data)) {
    reduceSubSessionMessageEvent?.(data);
    return true;
  }
  const messageEvent = data ?? {};
  const shouldProjectMain = shouldProjectMainSessionEvent(event, messageEvent);
  logRouteEvaluation(event, messageEvent, shouldProjectMain, context);
  return shouldProjectMain ? projectMainSessionEvent(messageEvent, context) : false;
}

export function isIgnoredSubSessionEvent(event, data) {
  return shouldProjectSubSessionEvent(event, data);
}
