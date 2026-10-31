/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { normalizeTrimmedString } from "./utils.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { normalizeTurnTransportEnvelope } from "./turnTransportEnvelope.js";
import { isEventForCurrentTurn } from "./sendFlowSupport.js";
import { handleBasicStreamEvent, handleInteractionRequestStreamEvent } from "./streamHandlers.js";
import { routeRuntimeStreamEvent } from "../../../../extensions/runtime-stream-router.js";
import {
  routeCurrentTurnLifecycleEvent,
  routeForeignTurnLifecycleEvent,
} from "./turnLifecycleRouter.js";
import { routeMessageProjectionEvent } from "./messageProjectionRouter.js";
import { buildStreamEventLogEntry } from "./streamEventLogEntry.js";
import { logPluginRuntimeDiagnostics } from "../../../debug/loggers/pluginRuntimeDiagnosticsLogger.js";
import { logStreamDeltaDebug } from "../../../debug/loggers/streamDeltaDebugLogger.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";

function logStreamDeltaEntry(entry) {
  logStreamDeltaDebug(entry.event, () => ({
    sessionId: entry.sessionId,
    dialogProcessId: entry.dialogProcessId,
    turnScopeId: entry.turnScopeId,
    ...entry.data,
  }));
}

export function logStreamEvent(entry, authoritativeEvent, logSessionEvent) {
  if (isTransientMessageEvent(authoritativeEvent)) {
    logStreamDeltaEntry(entry);
    return;
  }
  logSessionEvent(entry);
}

function routePostProjectionEvent(event, data, context) {
  const {
    activeSession,
    botMessage,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    makeViewAttachments,
    navigateOnFirstResponseOnce,
    setPendingInteractionRequest,
    logSessionEvent,
    channelSessionId,
    protocolEnvelope,
    sessionId,
  } = context;
  const isInteractionForCurrentChannel =
    protocolEnvelope?.protocol?.family === EVENT_FAMILY.INTERACTION_REQUEST &&
    normalizeTrimmedString(channelSessionId) === normalizeTrimmedString(sessionId);
  if (
    event !== StreamEventEnum.ATTACHMENT_LIFECYCLE &&
    !isInteractionForCurrentChannel &&
    !isEventForCurrentTurn(data || {}, botMessage)
  )
    return true;
  if (
    handleBasicStreamEvent(event, {
      data,
      botMessage,
      navigateOnFirstResponseOnce,
      activeSession,
      makeViewAttachments,
      logSessionEvent,
    })
  )
    return true;
  if (event === StreamEventEnum.INTERACTION_REQUEST) {
    handleInteractionRequestStreamEvent({
      data,
      channelSessionId,
      clearMissingInteractionPayloadTimer,
      navigateOnFirstResponseOnce,
      setPendingInteractionRequest,
      clearPendingInteraction,
    });
  }
  return true;
}

export function logRuntimeRouteCompleted({ routed, authoritativeEvent, logSessionEvent }) {
  if (!routed) return;
  const entry = {
    category: "transport",
    level: "info",
    event: "frontend.runtimeStream.routeCompleted",
    sessionId: String(authoritativeEvent.identity.sessionId),
    dialogProcessId: String(authoritativeEvent.payload?.dialogProcessId || ""),
    turnScopeId: String(authoritativeEvent.identity.turnScopeId),
    data: {
      eventType: String(authoritativeEvent.identity.eventType),
      eventFamily: String(authoritativeEvent.protocol.family),
      routed,
    },
  };
  if (isTransientMessageEvent(authoritativeEvent)) {
    logStreamDeltaEntry(entry);
    return;
  }
  logSessionEvent(entry);
}

function routeAuthoritativeRuntimeEvent({
  protocolEnvelope,
  applyWorkflowRuntimeEvent,
  logSessionEvent,
  sessionId,
  turnScopeId,
}) {
  if (!protocolEnvelope) return false;
  const routed = routeRuntimeStreamEvent(protocolEnvelope, {
    source: "live",
    logRuntimeProjectionDiagnostics: logPluginRuntimeDiagnostics,
    applyWorkflowRuntimeEvent,
    logSessionEvent,
    sessionId,
    turnScopeId,
  });
  logRuntimeRouteCompleted({
    routed,
    authoritativeEvent: protocolEnvelope,
    logSessionEvent,
  });
  return routed;
}

export const PROTOCOL_ENVELOPE_REJECTED_CODE = "PROTOCOL_ENVELOPE_REJECTED";

function createProtocolEnvelopeRejectedError(channelEvent, errors) {
  const error = new Error(`protocol envelope rejected: ${channelEvent} (${errors.join(", ")})`);
  error.code = PROTOCOL_ENVELOPE_REJECTED_CODE;
  error.details = { channelEvent, errors };
  return error;
}

export function createSendStreamEventHandler(context) {
  const {
    activeSession,
    applyConversationState,
    applyTurnLifecycleEnvelope,
    applyWorkflowRuntimeEvent,
    botMessage: botMsg,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    logSessionEvent,
    makeViewMessage,
    makeViewAttachments,
    navigateOnFirstResponseOnce,
    sessionId,
    setPendingInteractionRequest,
    turnScopeId,
    findMessagesByPresentationId,
    findSession,
    findUserMessageForCommit,
    materializeTurnPresentation,
    reduceSubSessionMessageEvent,
  } = context;

  return (incomingEnvelope) => {
    const { event, data, protocolEnvelope, family, rejected, channelSessionId } =
      normalizeTurnTransportEnvelope(incomingEnvelope);
    if (rejected) {
      logSessionEvent({
        category: "transport",
        level: "warn",
        event: "frontend.transport.protocolEnvelopeRejected",
        sessionId,
        dialogProcessId: "",
        turnScopeId,
        data: { channelEvent: event, errors: rejected.errors },
      });

      throw createProtocolEnvelopeRejectedError(event, rejected.errors);
    }
    const authoritativeEvent = protocolEnvelope;
    logStreamEvent(
      buildStreamEventLogEntry({
        authoritativeEvent,
        botMsg,
        data,
        event,
        sessionId,
        turnScopeId,
      }),
      authoritativeEvent,
      logSessionEvent,
    );
    logResendDebug("send.stream.event", () => ({
      event,
      eventTurnScopeId: data?.turnScopeId,
      eventDialogProcessId: data?.dialogProcessId,
      state: data?.state,
      botMessage: summarizeDebugMessage(botMsg),
    }));

    if (event === StreamEventEnum.CHANNEL_STATE) {
      applyConversationState(data);
      return;
    }
    if (
      routeForeignTurnLifecycleEvent(event, data, {
        applyTurnLifecycleEnvelope,
        logSessionEvent,
        sessionId,
      })
    )
      return;
    if (
      routeCurrentTurnLifecycleEvent(event, data, {
        applyTurnLifecycleEnvelope,
        findSession,
        findUserMessageForCommit,
        logSessionEvent,
        makeViewMessage,
        sessionId,
      })
    )
      return;
    if (
      routeAuthoritativeRuntimeEvent({
        protocolEnvelope,
        applyWorkflowRuntimeEvent,
        logSessionEvent,
        sessionId,
        turnScopeId,
      })
    )
      return;
    if (
      routeMessageProjectionEvent(protocolEnvelope, family, {
        channelSessionId,
        findMessagesByPresentationId,
        materializeTurnPresentation,
        logSessionEvent,
        navigateOnFirstResponseOnce,
        reduceSubSessionMessageEvent,
      })
    )
      return;
    routePostProjectionEvent(event, data, {
      activeSession,
      botMessage: botMsg,
      clearMissingInteractionPayloadTimer,
      clearPendingInteraction,
      makeViewAttachments,
      navigateOnFirstResponseOnce,
      setPendingInteractionRequest,
      logSessionEvent,
      channelSessionId,
      protocolEnvelope,
      sessionId,
    });
  };
}
