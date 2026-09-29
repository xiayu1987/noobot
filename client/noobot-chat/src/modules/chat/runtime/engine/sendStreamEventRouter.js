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
import {
  isIgnoredSubSessionEvent,
  routeMessageProjectionEvent,
} from "./messageProjectionRouter.js";
import { routeTerminalStreamEvent } from "./terminalStreamRouter.js";
import { buildStreamEventLogEntry } from "./streamEventLogEntry.js";
import { logPluginRuntimeDiagnostics } from "../../../debug/loggers/pluginRuntimeDiagnosticsLogger.js";
import { logStreamDeltaDebug } from "../../../debug/loggers/streamDeltaDebugLogger.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";

// Transient (live-only) deltas are per-chunk; their per-event diagnostics go to the
// switchable `stream-delta` debug channel instead of the main transport category.
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
    applyConversationStateFromEvent,
    botMessage,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    makeViewMessage,
    mergeAssistantAttachments,
    navigateOnFirstResponseOnce,
    tryAutoResolveInteraction,
    setPendingInteractionRequest,
    logSessionEvent,
    terminalRouteContext,
    ignoredSubSessionEvent,
    channelSessionId,
    protocolEnvelope,
    sessionId,
  } = context;
  if (ignoredSubSessionEvent) return true;
  const isInteractionForCurrentChannel =
    protocolEnvelope?.protocol?.family === EVENT_FAMILY.INTERACTION_REQUEST &&
    normalizeTrimmedString(channelSessionId) === normalizeTrimmedString(sessionId);
  if (
    event !== StreamEventEnum.ATTACHMENT_LIFECYCLE &&
    !isInteractionForCurrentChannel &&
    !isEventForCurrentTurn(data || {}, botMessage)
  )
    return true;
  applyConversationStateFromEvent(event, data || {}, {
    botMessage,
    fallbackDialogProcessId: normalizeTrimmedString(botMessage.dialogProcessId),
    fallbackTurnScopeId: normalizeTrimmedString(botMessage.turnScopeId),
  });
  if (
    event === StreamEventEnum.CHANNEL_STATE &&
    routeTerminalStreamEvent(event, data, terminalRouteContext)
  )
    return true;
  if (
    handleBasicStreamEvent(event, {
      data,
      botMessage,
      classifyRealtimeLog,
      navigateOnFirstResponseOnce,
      activeSession,
      mergeAssistantAttachments,
      makeViewMessage,
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
      tryAutoResolveInteraction,
      setPendingInteractionRequest,
      clearPendingInteraction,
    });
  } else {
    routeTerminalStreamEvent(event, data, terminalRouteContext);
  }
  return true;
}

export function logRuntimeRouteCompleted({
  routed,
  data,
  authoritativeEvent,
  authoritativeIdentity,
  authoritativePayload,
  logSessionEvent,
  sessionId,
  turnScopeId,
}) {
  // routed=false only means "not a runtime-stream event": the event continues to the
  // message-projection / post-projection routers, so it is neither completed nor anomalous here.
  if (!routed) return;
  const entry = {
    category: "transport",
    level: "info",
    event: "frontend.runtimeStream.routeCompleted",
    sessionId: authoritativeIdentity.sessionId || data?.sessionId || sessionId,
    dialogProcessId: authoritativePayload.dialogProcessId || data?.dialogProcessId || "",
    turnScopeId: authoritativeIdentity.turnScopeId || data?.turnScopeId || turnScopeId,
    data: {
      eventType: String(authoritativeEvent?.identity?.eventType || ""),
      eventFamily: String(authoritativeEvent?.protocol?.family || ""),
      routed,
    },
  };
  if (isTransientMessageEvent(authoritativeEvent)) {
    logStreamDeltaEntry(entry);
    return;
  }
  logSessionEvent?.(entry);
}

function routeAuthoritativeRuntimeEvent({
  event,
  data,
  protocolEnvelope,
  authoritativeEvent,
  authoritativeIdentity,
  authoritativePayload,
  applyWorkflowRuntimeEvent,
  logSessionEvent,
  sessionId,
  turnScopeId,
  reduceSubSessionMessageEvent,
}) {
  if (protocolEnvelope?.identity?.eventType !== event) return false;
  const routed = routeRuntimeStreamEvent(protocolEnvelope, {
    source: "live",
    logRuntimeProjectionDiagnostics: logPluginRuntimeDiagnostics,
    applyWorkflowRuntimeEvent,
    logSessionEvent,
    sessionId,
    turnScopeId,
    reduceSubSessionMessageEvent,
  });
  logRuntimeRouteCompleted({
    routed,
    data,
    authoritativeEvent,
    authoritativeIdentity,
    authoritativePayload,
    logSessionEvent,
    sessionId,
    turnScopeId,
  });
  return routed;
}

export function createSendStreamEventHandler(context) {
  const {
    activeSession,
    activeSessionId,
    applyConversationState,
    applyConversationStateFromEvent,
    applyRunStateEvent,
    applyTurnLifecycleEnvelope,
    applyWorkflowRuntimeEvent,
    botMessage: botMsg,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    foldMessagesForView,
    logSessionEvent,
    makeViewMessage,
    mergeAssistantAttachments,
    navigateOnFirstResponseOnce,
    requestedTextStreaming,
    sessionId,
    setPendingInteractionRequest,
    streamState,
    tryAutoResolveInteraction,
    turnScopeId,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    reduceSubSessionMessageEvent,
  } = context;

  return (incomingEnvelope) => {
    const { event, data, protocolEnvelope, channelSessionId } = normalizeTurnTransportEnvelope({
      ...(incomingEnvelope || {}),
      source: "realtime",
    });
    const authoritativeEvent = protocolEnvelope;
    const authoritativeIdentity = authoritativeEvent?.identity || {};
    const authoritativePayload = authoritativeEvent?.payload || {};
    logStreamEvent(
      buildStreamEventLogEntry({
        activeSession,
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

    if (
      routeForeignTurnLifecycleEvent(event, data, {
        activeSession,
        applyTurnLifecycleEnvelope,
        logSessionEvent,
        sessionId,
      })
    )
      return;
    if (
      routeCurrentTurnLifecycleEvent(event, data, {
        activeSession,
        applyTurnLifecycleEnvelope,
        findCanonicalMessageById,
        logSessionEvent,
        makeViewMessage,
        sessionId,
      })
    )
      return;
    if (
      routeAuthoritativeRuntimeEvent({
        event,
        data,
        protocolEnvelope,
        authoritativeEvent,
        authoritativeIdentity,
        authoritativePayload,
        applyWorkflowRuntimeEvent,
        logSessionEvent,
        sessionId,
        turnScopeId,
        reduceSubSessionMessageEvent,
      })
    )
      return;
    if (
      routeMessageProjectionEvent(event, data, {
        botMessage: botMsg,
        channelSessionId,
        findCanonicalMessageById,
        findCanonicalMessagesById,
        materializeTurnPresentation,
        logSessionEvent,
        navigateOnFirstResponseOnce,
        reduceSubSessionMessageEvent,
        sessionId,
        turnScopeId,
      })
    )
      return;
    const ignoredSubSessionEvent = isIgnoredSubSessionEvent(event, data);
    const terminalContext = {
      activeSession,
      activeSessionId,
      applyConversationState,
      applyRunStateEvent,
      botMessage: botMsg,
      classifyRealtimeLog,
      clearPendingInteraction,
      foldMessagesForView,
      makeViewMessage,
      mergeAssistantAttachments,
      navigateOnFirstResponseOnce,
      requestedTextStreaming,
      streamState,
    };
    routePostProjectionEvent(event, data, {
      activeSession,
      activeSessionId,
      applyConversationState,
      applyConversationStateFromEvent,
      applyRunStateEvent,
      botMessage: botMsg,
      classifyRealtimeLog,
      clearMissingInteractionPayloadTimer,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete,
      foldMessagesForView,
      makeViewMessage,
      mergeAssistantAttachments,
      navigateOnFirstResponseOnce,
      requestedTextStreaming,
      streamState,
      tryAutoResolveInteraction,
      setPendingInteractionRequest,
      logSessionEvent,
      terminalRouteContext: terminalContext,
      ignoredSubSessionEvent,
      channelSessionId,
      protocolEnvelope,
      sessionId,
    });
  };
}
