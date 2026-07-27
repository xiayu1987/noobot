/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants.js";
import { MESSAGE_EVENT_ENVELOPE_KIND } from "@noobot/shared/message-event-protocol";
import { normalizeTrimmedString } from "./utils.js";
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger.js";
import { normalizeTurnTransportEnvelope } from "./turnTransportEnvelope.js";
import {
  hasDialogProcessConflictForTurn, isEventForCurrentTurn, isUserStoppedEvent,
} from "./sendFlowSupport.js";
import { handleBasicStreamEvent, handleInteractionRequestStreamEvent } from "./streamHandlers.js";
import { routeWorkflowStreamEvent } from "./workflowStreamRouter.js";
import { routeCurrentTurnLifecycleEvent, routeForeignTurnLifecycleEvent } from "./turnLifecycleRouter.js";
import { isIgnoredSubSessionEvent, routeMessageProjectionEvent } from "./messageProjectionRouter.js";
import { routeTerminalStreamEvent } from "./terminalStreamRouter.js";

export function createSendStreamEventHandler(context) {
  const {
    activeSession, activeSessionId, applyConversationState, applyConversationStateFromEvent,
    applyRunStateEvent, applyWorkflowRuntimeEvent, botMessage: botMsg, classifyRealtimeLog,
    clearMissingInteractionPayloadTimer, clearPendingInteraction, connectorTypeSet,
    doneTurnFinalizer, foldMessagesForView, locateDoneMessage, locateSendingStartedMessageOnce,
    logSessionEvent, makeViewMessage, mergeAssistantAttachments, navigateOnFirstResponseOnce,
    refreshSessionConnectorsAsync, requestedTextStreaming, sessionId, setPendingInteractionRequest,
    startFinalDoneSessionDetailOnce, streamState, tryAutoResolveInteraction, turnScopeId,
    upsertConnectedConnectorInPanelState, upsertSubSessionEvent, upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent,
  } = context;

  return (incomingEnvelope) => {
    const { event, data } = normalizeTurnTransportEnvelope({
      ...(incomingEnvelope || {}),
      source: "realtime",
    });
    const authoritativeEvent = data?.event || {};
    const subProjectionChecks = {
      eventName: event === "subagent_message_event",
      channelKind: data?.channelKind === "message_event",
      channelVersion: Number(data?.channelVersion) === 1,
      envelopeKind: authoritativeEvent?.envelopeKind === MESSAGE_EVENT_ENVELOPE_KIND,
    };
    if (event === "subagent_message_event" || data?.route?.scope === "sub_session") {
      logSessionEvent({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "frontend.subagentMessage.projectionEvaluated",
        sessionId: data?.route?.rootSessionId || sessionId,
        dialogProcessId: authoritativeEvent?.dialogProcessId || data?.dialogProcessId || "",
        turnScopeId: authoritativeEvent?.turnScopeId || data?.turnScopeId || turnScopeId,
        data: {
          projected: Object.values(subProjectionChecks).every(Boolean),
          checks: subProjectionChecks,
          eventType: authoritativeEvent?.eventType || "",
          messageId: authoritativeEvent?.messageId || "",
          childSessionId: authoritativeEvent?.sessionId || data?.route?.sessionId || "",
          parentSessionId: authoritativeEvent?.parentSessionId || data?.route?.parentSessionId || "",
          workflowRunId: authoritativeEvent?.workflowRunId || "",
          nodeExecutionId: authoritativeEvent?.nodeExecutionId || "",
          hasContent: Boolean(authoritativeEvent?.content || authoritativeEvent?.delta || authoritativeEvent?.text),
          hasTool: Boolean(authoritativeEvent?.tool),
          hasResult: authoritativeEvent?.result !== undefined,
        },
      });
    }
    logSessionEvent({
      category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
      event: `stream.${event || "event"}`,
      sessionId: data?.sessionId || sessionId,
      dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMsg.dialogProcessId),
      turnScopeId: data?.turnScopeId || turnScopeId,
      data: {
        streamEvent: event,
        state: data?.state || "",
        seq: data?.seq || 0,
        hasContent: Boolean(data?.content || data?.delta || data?.message),
      },
    });
    logResendDebug("send.stream.event", {
      event,
      eventTurnScopeId: data?.turnScopeId,
      eventDialogProcessId: data?.dialogProcessId,
      state: data?.state,
      botMessage: summarizeDebugMessage(botMsg),
    });
    if (routeWorkflowStreamEvent(event, data, {
      applyWorkflowRuntimeEvent, logSessionEvent, sessionId, turnScopeId,
      upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent,
    })) return;
    if (routeMessageProjectionEvent(event, data, {
      applyWorkflowRuntimeEvent, botMessage: botMsg, classifyRealtimeLog,
      locateSendingStartedMessageOnce, logSessionEvent, navigateOnFirstResponseOnce,
      sessionId, turnScopeId, upsertSubSessionEvent,
    })) return;
    if (isIgnoredSubSessionEvent(event, data)) return;
    if (routeForeignTurnLifecycleEvent(event, data, { activeSession, sessionId, upsertSubSessionEvent })) return;
    if (!isEventForCurrentTurn(data || {}, botMsg)) return;
    if (routeCurrentTurnLifecycleEvent(event, data, { activeSession, applyRunStateEvent, sessionId })) return;
    if (isUserStoppedEvent(event, data || {}) && hasDialogProcessConflictForTurn({
      activeSession,
      data: data || {},
      botMessage: botMsg,
    })) return;
    applyConversationStateFromEvent(event, data || {}, {
      botMessage: botMsg,
      fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
      fallbackTurnScopeId: normalizeTrimmedString(botMsg.turnScopeId),
    });
    const terminalContext = {
      activeSession, activeSessionId, applyConversationState, applyRunStateEvent, botMessage: botMsg,
      classifyRealtimeLog, clearPendingInteraction, doneTurnFinalizer, foldMessagesForView,
      locateDoneMessage, locateSendingStartedMessageOnce, makeViewMessage, mergeAssistantAttachments,
      navigateOnFirstResponseOnce, requestedTextStreaming, startFinalDoneSessionDetailOnce, streamState,
    };
    if ([StreamEventEnum.CHANNEL_STATE, StreamEventEnum.ERROR].includes(event)
      && routeTerminalStreamEvent(event, data, terminalContext)) return;
    if (
      handleBasicStreamEvent(event, {
        data,
        botMessage: botMsg,
        classifyRealtimeLog,
        navigateOnFirstResponseOnce,
        activeSession,
        connectorTypeSet,
        upsertConnectedConnectorInPanelState,
        refreshSessionConnectorsAsync,
        mergeAssistantAttachments,
        makeViewMessage,
        locateSendingStartedMessageOnce,
      })
    ) {
      return;
    }
    if (event === StreamEventEnum.INTERACTION_REQUEST) {
      handleInteractionRequestStreamEvent({
        data,
        clearMissingInteractionPayloadTimer,
        navigateOnFirstResponseOnce,
        tryAutoResolveInteraction,
        setPendingInteractionRequest,
      });
    } else routeTerminalStreamEvent(event, data, terminalContext);
  };
}
