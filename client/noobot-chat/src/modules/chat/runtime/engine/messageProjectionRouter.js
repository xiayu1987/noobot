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

function describeProjectionTarget(targetMessage) {
  if (targetMessage === null) return { found: false };
  return {
    found: true,
    role: targetMessage.role,
    type: targetMessage.type,
    contentLength: targetMessage.content.length,
  };
}

function reduceProjectionTargets(messageEvent, targetMessages) {
  return targetMessages.map((message) =>
    dispatchTurnEnvelope({
      targetMessage: message,
      envelope: messageEvent,
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
    }),
  );
}

function logProjectionReduction({ messageEvent, reductions, applied, targetMessage, context }) {
  logProjectionOutcome(context, applied, {
    event: "frontend.messageEvent.reduced",
    messageEvent,
    data: {
      source: TURN_PROJECTION_SOURCE.NORMAL_LIVE,
      eventId: messageEvent.identity.eventId,
      eventType: messageEvent.payload.eventType,
      presentationMessageId: resolveMessageEventPresentationId(messageEvent.payload),
      sequence: messageEvent.ordering.sequence,
      reductions: reductions.map(({ result, errors }) => ({ result, errors })),
      target: describeProjectionTarget(targetMessage),
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
  const reductions = reduceProjectionTargets(messageEvent, targetMessages);
  const applied = reductions.some((reduction) => reduction.applied === true);
  logProjectionReduction({ messageEvent, reductions, applied, targetMessage, context });
  if (applied) context.navigateOnFirstResponseOnce();
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
