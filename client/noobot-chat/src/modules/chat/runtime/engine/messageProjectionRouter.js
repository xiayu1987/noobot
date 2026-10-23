/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_TYPE,
  isWorkflowNodeMessageEvent,
  resolveMessageEventPresentationId,
} from "@noobot/event-protocol/message-event";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./turnProjectionStore.js";
import { RoleEnum } from "../../model/chatConstants.js";
import { logTransportDiagnostics } from "../../../debug/loggers/transportDiagnosticsLogger.js";

function envelopeLogFields(messageEvent) {
  const { identity, payload } = messageEvent;
  return {
    sessionId: identity.sessionId,
    dialogProcessId: payload.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    eventId: identity.eventId,
    eventType: payload.eventType,
  };
}

function logProjectionOutcome(context, succeeded, { event, messageEvent, data }) {
  const { sessionId, dialogProcessId, turnScopeId } = envelopeLogFields(messageEvent);
  if (succeeded) {
    logTransportDiagnostics(event, () => ({ sessionId, dialogProcessId, turnScopeId, ...data }));
    return;
  }
  context.logSessionEvent({
    category: "transport",
    level: "warn",
    event,
    sessionId,
    dialogProcessId,
    turnScopeId,
    data,
  });
}

function logRouteEvaluation(messageEvent, ownedByChannel) {
  const fields = envelopeLogFields(messageEvent);
  logTransportDiagnostics("frontend.messageEvent.routeEvaluated", () => ({
    ...fields,
    ownedByChannel,
    presentationMessageId: resolveMessageEventPresentationId(messageEvent.payload),
  }));
}

function materializeCommittedPresentation(messageEvent, context) {
  if (messageEvent.payload.eventType !== MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    return true;
  }
  const materialized = context.materializeTurnPresentation(messageEvent);
  logProjectionOutcome(context, materialized.applied === true, {
    event: "frontend.messageEvent.presentationMaterialized",
    messageEvent,
    data: materialized,
  });
  return materialized.applied;
}

function addLiveBotProjection(targetMessages, messageEvent, context) {
  const { botMessage } = context;
  const { identity } = messageEvent;
  const ownsLiveBot =
    botMessage.sessionId === identity.sessionId &&
    botMessage.turnScopeId === identity.turnScopeId &&
    botMessage.role === RoleEnum.ASSISTANT;
  if (ownsLiveBot && !targetMessages.includes(botMessage)) targetMessages.push(botMessage);
}

function describeProjectionTarget(targetMessage) {
  return {
    found: Boolean(targetMessage),
    presentationMessageId: String(targetMessage?.presentationMessageId || ""),
    role: String(targetMessage?.role || ""),
    type: String(targetMessage?.type || ""),
    phase: String(targetMessage?.pluginMeta?.phase || ""),
    contentLength: String(targetMessage?.content || "").length,
  };
}

function reduceProjectionTargets(messageEvent, targetMessages) {
  const reductions = targetMessages.map((message) =>
    dispatchTurnEnvelope({
      targetMessage: message,
      envelope: messageEvent,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    }),
  );
  return (
    reductions.find((item) => item.applied) ||
    reductions[0] || { result: "target_missing", applied: false }
  );
}

function logProjectionReduction({ messageEvent, reduction, targetMessage, targetBefore, context }) {
  logProjectionOutcome(context, reduction.applied === true, {
    event: "frontend.messageEvent.reduced",
    messageEvent,
    data: {
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      eventId: messageEvent.identity.eventId,
      eventType: messageEvent.payload.eventType,
      presentationMessageId: resolveMessageEventPresentationId(messageEvent.payload),
      sequence: messageEvent.ordering.sequence,
      result: reduction.result,
      errors: reduction.errors || [],
      targetBefore,
      targetAfter: describeProjectionTarget(targetMessage),
    },
  });
}

function projectMainSessionEvent(messageEvent, context) {
  if (!materializeCommittedPresentation(messageEvent, context)) return true;
  const presentationMessageId = resolveMessageEventPresentationId(messageEvent.payload);
  const targetMessages = context.findMessagesByPresentationId(
    messageEvent.identity.sessionId,
    presentationMessageId,
  );
  addLiveBotProjection(targetMessages, messageEvent, context);
  const targetMessage = targetMessages[targetMessages.length - 1] || null;
  const targetBefore = describeProjectionTarget(targetMessage);
  logProjectionOutcome(context, Boolean(targetMessage), {
    event: "frontend.messageEvent.targetResolved",
    messageEvent,
    data: {
      eventId: messageEvent.identity.eventId,
      eventType: messageEvent.payload.eventType,
      presentationMessageId,
      target: targetBefore,
    },
  });
  const reduction = reduceProjectionTargets(messageEvent, targetMessages);
  logProjectionReduction({ messageEvent, reduction, targetMessage, targetBefore, context });
  if (reduction.applied) context.navigateOnFirstResponseOnce();
  return true;
}

export function routeMessageProjectionEvent(protocolEnvelope, family, context) {
  if (family !== EVENT_FAMILY.MESSAGE_TIMELINE) return false;
  if (isWorkflowNodeMessageEvent(protocolEnvelope)) {
    context.reduceSubSessionMessageEvent(protocolEnvelope);
    return true;
  }
  const ownedByChannel = protocolEnvelope.identity.sessionId === context.channelSessionId;
  logRouteEvaluation(protocolEnvelope, ownedByChannel);
  if (ownedByChannel) projectMainSessionEvent(protocolEnvelope, context);
  return true;
}
