/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { normalizeTrimmedString } from "./utils.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { normalizeTurnTransportEnvelope } from "./turnTransportEnvelope.js";
import { hasDialogProcessConflictForTurn, isEventForCurrentTurn } from "./sendFlowSupport.js";
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
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";

function routePostProjectionEvent(event, data, context) {
  const {
    activeSession,
    activeSessionId,
    applyConversationState,
    applyConversationStateFromEvent,
    applyRunStateEvent,
    botMessage,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    doneTurnFinalizer,
    foldMessagesForView,
    locateDoneMessage,
    locateSendingStartedMessageOnce,
    makeViewMessage,
    mergeAssistantAttachments,
    navigateOnFirstResponseOnce,
    requestedTextStreaming,
    startFinalDoneSessionDetailOnce,
    streamState,
    tryAutoResolveInteraction,
    setPendingInteractionRequest,
    logSessionEvent,
    terminalRouteContext,
    ignoredSubSessionEvent,
  } = context;
  if (ignoredSubSessionEvent) return true;
  if (
    event !== StreamEventEnum.ATTACHMENT_LIFECYCLE &&
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
      locateSendingStartedMessageOnce,
    })
  )
    return true;
  if (event === StreamEventEnum.INTERACTION_REQUEST) {
    handleInteractionRequestStreamEvent({
      data,
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
    doneTurnFinalizer,
    foldMessagesForView,
    locateDoneMessage,
    locateSendingStartedMessageOnce,
    logSessionEvent,
    makeViewMessage,
    mergeAssistantAttachments,
    navigateOnFirstResponseOnce,
    requestedTextStreaming,
    sessionId,
    setPendingInteractionRequest,
    startFinalDoneSessionDetailOnce,
    streamState,
    tryAutoResolveInteraction,
    turnScopeId,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    reduceSubSessionMessageEvent,
  } = context;

  return (incomingEnvelope) => {
    const { event, data, protocolEnvelope } = normalizeTurnTransportEnvelope({
      ...(incomingEnvelope || {}),
      source: "realtime",
    });
    const authoritativeEvent = protocolEnvelope;
    const authoritativeIdentity = authoritativeEvent?.identity || {};
    const authoritativeOrdering = authoritativeEvent?.ordering || {};
    const authoritativePayload = authoritativeEvent?.payload || {};
    const lifecycleChildSessionId =
      event === StreamEventEnum.TURN_LIFECYCLE ? normalizeTrimmedString(data?.sessionId) : "";
    const lifecycleRootSessionId = normalizeTrimmedString(
      data?.parentSessionId || activeSession?.value?.sessionId || sessionId,
    );
    logSessionEvent({
      category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
      event: `stream.${event || "event"}`,
      sessionId:
        lifecycleChildSessionId && lifecycleChildSessionId !== lifecycleRootSessionId
          ? lifecycleRootSessionId
          : authoritativeIdentity.sessionId || data?.sessionId || sessionId,
      dialogProcessId:
        authoritativePayload.dialogProcessId ||
        data?.dialogProcessId ||
        normalizeTrimmedString(botMsg.dialogProcessId),
      turnScopeId: authoritativeIdentity.turnScopeId || data?.turnScopeId || turnScopeId,
      data: {
        streamEvent: event,
        state: data?.state || "",
        seq: data?.seq || 0,
        hasContent: typeof data?.payload?.text === "string",
        protocolName: String(authoritativeEvent?.protocol?.name || ""),
        protocolVersion: Number(authoritativeEvent?.protocol?.version || 0),
        eventFamily: String(authoritativeEvent?.protocol?.family || ""),
        schemaVersion: Number(authoritativeEvent?.protocol?.schemaVersion || 0),
        eventId: String(authoritativeIdentity.eventId || ""),
        eventType: String(authoritativeIdentity.eventType || ""),
        messageId: String(authoritativeIdentity.messageId || ""),
        presentationMessageId: String(authoritativePayload.presentationMessageId || ""),
        sequence: Number(authoritativeOrdering.sequence || 0),
        sequenceDomain: String(authoritativeOrdering.domain || ""),
        sequenceScopeId: String(authoritativeOrdering.scopeId || ""),
        textLength: String(authoritativePayload.text || "").length,
        childSessionId: lifecycleChildSessionId,
        parentSessionId: String(data?.parentSessionId || ""),
        lifecycleEventType: String(data?.eventType || ""),
        lifecycleRevision: Number(data?.revision || 0),
        lifecycleSequence: Number(data?.sequence || 0),
        lifecyclePersistenceScopeId: String(data?.persistenceScope?.scopeId || ""),
      },
    });
    logResendDebug("send.stream.event", () => ({
      event,
      eventTurnScopeId: data?.turnScopeId,
      eventDialogProcessId: data?.dialogProcessId,
      state: data?.state,
      botMessage: summarizeDebugMessage(botMsg),
    }));
    // Lifecycle packets are authoritative state input. Route them before any
    // extension or message projection so a plugin cannot consume a terminal
    // child event before the single turn-runtime reducer sees it.
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
      data?.identity?.eventType === event &&
      routeRuntimeStreamEvent(data, {
        source: "live",
        logRuntimeProjectionDiagnostics: logWorkflowDiagnostics,
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
        classifyRealtimeLog,
        findCanonicalMessageById,
        findCanonicalMessagesById,
        materializeTurnPresentation,
        locateSendingStartedMessageOnce,
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
      doneTurnFinalizer,
      foldMessagesForView,
      locateDoneMessage,
      locateSendingStartedMessageOnce,
      makeViewMessage,
      mergeAssistantAttachments,
      navigateOnFirstResponseOnce,
      requestedTextStreaming,
      startFinalDoneSessionDetailOnce,
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
      doneTurnFinalizer,
      foldMessagesForView,
      locateDoneMessage,
      locateSendingStartedMessageOnce,
      makeViewMessage,
      mergeAssistantAttachments,
      navigateOnFirstResponseOnce,
      requestedTextStreaming,
      startFinalDoneSessionDetailOnce,
      streamState,
      tryAutoResolveInteraction,
      setPendingInteractionRequest,
      logSessionEvent,
      terminalRouteContext: terminalContext,
      ignoredSubSessionEvent,
    });
  };
}
