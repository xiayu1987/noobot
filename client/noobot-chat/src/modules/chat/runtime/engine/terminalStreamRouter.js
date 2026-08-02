/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { requirePersistedTurnStatus } from "./sendFlowSupport.js";
import { handleDoneStreamEvent } from "./streamHandlers.js";

export function routeTerminalStreamEvent(event, data, context) {
  const {
    activeSession, activeSessionId, applyConversationState, botMessage,
    classifyRealtimeLog, clearPendingInteraction, doneTurnFinalizer, foldMessagesForView,
    locateDoneMessage, locateSendingStartedMessageOnce, makeViewMessage, mergeAssistantAttachments,
    navigateOnFirstResponseOnce, requestedTextStreaming, streamState,
  } = context;
  if (event === StreamEventEnum.CHANNEL_STATE) {
    // Channel state is transport observation only. Authority lifecycle
    // envelopes/snapshots are the sole source of run state and terminal facts.
    return true;
  }
  if (event === StreamEventEnum.ERROR) {
    streamState.lastStreamErrorEventData = data || {};
    return true;
  }
  if (event === StreamEventEnum.DONE) {
    requirePersistedTurnStatus(data, "completed");
    handleDoneStreamEvent({
      data, requestedTextStreaming, botMessage, activeSession, activeSessionId, clearPendingInteraction,
      classifyRealtimeLog, navigateOnFirstResponseOnce, makeViewMessage, foldMessagesForView,
      mergeAssistantAttachments, locateDoneMessage, applyConversationState, locateSendingStartedMessageOnce,
      suppressCompletionConversationState: true,
    });
    return true;
  }
  if (event === StreamEventEnum.USER_STOPPED) {
    requirePersistedTurnStatus(data, "user_stopped");
    // USER_STOPPED closes the data stream only. The matching authoritative
    // turn.stop_completed envelope owns lifecycle and presentation state.
    return true;
  }
  return false;
}
