/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { logStateMachineDebug, summarizeStateMachineMessage } from "../../../debug/loggers/stateMachineLogger.js";
import { normalizeTrimmedString } from "./utils.js";
import {
  buildFinalDoneEventData, hasCompletableRunIdentity, isCompletedChannelStateEvent, requirePersistedTurnStatus,
} from "./sendFlowSupport.js";
import { handleDoneStreamEvent } from "./streamHandlers.js";

export function routeTerminalStreamEvent(event, data, context) {
  const {
    activeSession, activeSessionId, applyConversationState, applyRunStateEvent, botMessage,
    classifyRealtimeLog, clearPendingInteraction, doneTurnFinalizer, foldMessagesForView,
    locateDoneMessage, locateSendingStartedMessageOnce, makeViewMessage, mergeAssistantAttachments,
    navigateOnFirstResponseOnce, requestedTextStreaming, startFinalDoneSessionDetailOnce, streamState,
  } = context;
  if (event === StreamEventEnum.CHANNEL_STATE) {
    const channelState = normalizeTrimmedString(data?.state);
    if (["completed", "user_stopped", "error", "expired", "cancelled"].includes(channelState)) {
      applyRunStateEvent?.({
        ...buildFinalDoneEventData({ data, activeSession, botMessage }),
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: channelState, backendState: channelState,
        source: "realtime_channel_terminal_notification",
      });
    }
    if (isCompletedChannelStateEvent(event, data || {}) && hasCompletableRunIdentity(data || {}, botMessage)) {
      streamState.finalDoneEventData = buildFinalDoneEventData({ data, activeSession, botMessage });
      logStateMachineDebug("stateMachine.done.finalize.detected", {
        source: "channel_state", backendState: channelState,
        sessionId: streamState.finalDoneEventData.sessionId,
        dialogProcessId: streamState.finalDoneEventData.dialogProcessId,
        turnScopeId: streamState.finalDoneEventData.turnScopeId,
        botMessage: summarizeStateMachineMessage(botMessage),
      });
      startFinalDoneSessionDetailOnce("channel_state");
    }
    return true;
  }
  if (event === StreamEventEnum.ERROR) {
    streamState.lastStreamErrorEventData = data || {};
    return true;
  }
  if (event === StreamEventEnum.DONE) {
    requirePersistedTurnStatus(data, "completed");
    streamState.finalDoneEventData = buildFinalDoneEventData({ data, activeSession, botMessage });
    applyRunStateEvent?.({
      ...streamState.finalDoneEventData, type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      backendState: "completed", source: "realtime_done_terminal_notification",
    });
    logStateMachineDebug("stateMachine.done.finalize.detected", {
      source: "done_event", sessionId: streamState.finalDoneEventData.sessionId,
      dialogProcessId: streamState.finalDoneEventData.dialogProcessId,
      turnScopeId: streamState.finalDoneEventData.turnScopeId,
      botMessage: summarizeStateMachineMessage(botMessage),
    });
    startFinalDoneSessionDetailOnce("done_event");
    handleDoneStreamEvent({
      data, requestedTextStreaming, botMessage, activeSession, activeSessionId, clearPendingInteraction,
      classifyRealtimeLog, navigateOnFirstResponseOnce, makeViewMessage, foldMessagesForView,
      mergeAssistantAttachments, locateDoneMessage, applyConversationState, locateSendingStartedMessageOnce,
      suppressCompletionConversationState: Boolean(doneTurnFinalizer.promise),
    });
    return true;
  }
  if (event === StreamEventEnum.USER_STOPPED) {
    requirePersistedTurnStatus(data, "user_stopped");
    streamState.finalUserStopEventData = {
      ...(data || {}),
      sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
      dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMessage.dialogProcessId),
    };
    return true;
  }
  return false;
}
