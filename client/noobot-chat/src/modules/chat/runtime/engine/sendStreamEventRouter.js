/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { MESSAGE_EVENT_ENVELOPE_KIND } from "@noobot/event-protocol/message-event";
import { normalizeTrimmedString } from "./utils.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { normalizeTurnTransportEnvelope } from "./turnTransportEnvelope.js";
import {
  hasDialogProcessConflictForTurn,
  isEventForCurrentTurn,
  isUserStoppedEvent,
} from "./sendFlowSupport.js";
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

function logSubagentProjectionEvaluation({
  event,
  data,
  authoritativeEvent,
  sessionId,
  turnScopeId,
  logSessionEvent,
}) {
  if (event !== "subagent_message_event" && data?.route?.scope !== "sub_session") return;
  const checks = {
    eventName: event === "subagent_message_event",
    channelKind: data?.channelKind === "message_event",
    channelVersion: Number(data?.channelVersion) === 1,
    envelopeKind: authoritativeEvent?.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND,
  };
  logSessionEvent({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: "frontend.subagentMessage.projectionEvaluated",
    sessionId: data?.route?.rootSessionId || sessionId,
    dialogProcessId: authoritativeEvent?.dialogProcessId || data?.dialogProcessId || "",
    turnScopeId: authoritativeEvent?.turnScopeId || data?.turnScopeId || turnScopeId,
    data: {
      projected: Object.values(checks).every(Boolean),
      checks,
      eventType: authoritativeEvent?.eventType || "",
      messageId: authoritativeEvent?.messageId || "",
      childSessionId: authoritativeEvent?.sessionId || data?.route?.sessionId || "",
      parentSessionId: authoritativeEvent?.parentSessionId || data?.route?.parentSessionId || "",
      workflowRunId: authoritativeEvent?.workflowRunId || "",
      nodeExecutionId: authoritativeEvent?.nodeExecutionId || "",
      hasContent: Boolean(
        authoritativeEvent?.content || authoritativeEvent?.delta || authoritativeEvent?.text,
      ),
      hasTool: Boolean(authoritativeEvent?.tool),
      hasResult: authoritativeEvent?.result !== undefined,
    },
  });
}

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
    connectorTypeSet,
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
    refreshSessionConnectorsAsync,
    upsertConnectedConnectorInPanelState,
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
  if (
    isUserStoppedEvent(event, data || {}) &&
    hasDialogProcessConflictForTurn({ activeSession, data: data || {}, botMessage })
  )
    return true;
  applyConversationStateFromEvent(event, data || {}, {
    botMessage,
    fallbackDialogProcessId: normalizeTrimmedString(botMessage.dialogProcessId),
    fallbackTurnScopeId: normalizeTrimmedString(botMessage.turnScopeId),
  });
  if (
    [StreamEventEnum.CHANNEL_STATE, StreamEventEnum.ERROR].includes(event) &&
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
      connectorTypeSet,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
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
    connectorTypeSet,
    doneTurnFinalizer,
    foldMessagesForView,
    locateDoneMessage,
    locateSendingStartedMessageOnce,
    logSessionEvent,
    makeViewMessage,
    mergeAssistantAttachments,
    navigateOnFirstResponseOnce,
    refreshSessionConnectorsAsync,
    requestedTextStreaming,
    sessionId,
    setPendingInteractionRequest,
    startFinalDoneSessionDetailOnce,
    streamState,
    tryAutoResolveInteraction,
    turnScopeId,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    upsertConnectedConnectorInPanelState,
  } = context;

  return (incomingEnvelope) => {
    const { event, data } = normalizeTurnTransportEnvelope({
      ...(incomingEnvelope || {}),
      source: "realtime",
    });
    const authoritativeEvent = data?.event || {};
    const lifecycleChildSessionId =
      event === StreamEventEnum.TURN_LIFECYCLE ? normalizeTrimmedString(data?.sessionId) : "";
    const lifecycleRootSessionId = normalizeTrimmedString(
      data?.parentSessionId || activeSession?.value?.sessionId || sessionId,
    );
    logSubagentProjectionEvaluation({
      event,
      data,
      authoritativeEvent,
      sessionId,
      turnScopeId,
      logSessionEvent,
    });
    logSessionEvent({
      category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
      event: `stream.${event || "event"}`,
      sessionId:
        lifecycleChildSessionId && lifecycleChildSessionId !== lifecycleRootSessionId
          ? lifecycleRootSessionId
          : authoritativeEvent?.sessionId || data?.sessionId || sessionId,
      dialogProcessId:
        authoritativeEvent?.dialogProcessId ||
        data?.dialogProcessId ||
        normalizeTrimmedString(botMsg.dialogProcessId),
      turnScopeId: authoritativeEvent?.turnScopeId || data?.turnScopeId || turnScopeId,
      data: {
        streamEvent: event,
        state: data?.state || "",
        seq: data?.seq || 0,
        hasContent: Boolean(data?.content || data?.delta || data?.message),
        eventId: String(authoritativeEvent?.eventId || ""),
        eventType: String(authoritativeEvent?.eventType || ""),
        messageId: String(authoritativeEvent?.messageId || ""),
        presentationMessageId: String(authoritativeEvent?.presentationMessageId || ""),
        envelopeKind: String(authoritativeEvent?.envelopeKind || ""),
        envelopeVersion: Number(authoritativeEvent?.envelopeVersion || 0),
        sequence: Number(authoritativeEvent?.sequence || 0),
        sequenceDomain: String(authoritativeEvent?.sequenceDomain || ""),
        sequenceScopeId: String(
          authoritativeEvent?.sequenceScopeId || authoritativeEvent?.messageId || "",
        ),
        authority: String(authoritativeEvent?.authority || ""),
        textLength: String(authoritativeEvent?.text || "").length,
        outputLength: String(authoritativeEvent?.output || "").length,
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
      routeRuntimeStreamEvent(event, data, {
        source: "live",
        logRuntimeProjectionDiagnostics: logWorkflowDiagnostics,
        applyWorkflowRuntimeEvent,
        logSessionEvent,
        sessionId,
        turnScopeId,
      })
    )
      return;
    if (
      routeMessageProjectionEvent(event, data, {
        botMessage: botMsg,
        classifyRealtimeLog,
        findCanonicalMessageById,
        findCanonicalMessagesById,
        locateSendingStartedMessageOnce,
        logSessionEvent,
        navigateOnFirstResponseOnce,
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
      connectorTypeSet,
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
      refreshSessionConnectorsAsync,
      upsertConnectedConnectorInPanelState,
      logSessionEvent,
      terminalRouteContext: terminalContext,
      ignoredSubSessionEvent,
    });
  };
}
