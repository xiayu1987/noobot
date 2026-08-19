/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { takeReplayCacheGroupsForSession } from "./replayCache.js";
import { applyReconnectReplayBatchToActiveSession } from "./messageReplay.js";
import { _trimStr, normalizeExecutionLogForRealtime } from "./utils.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";

export async function consumeReconnectReplayCacheForSession({
  replayCache,
  sessionId = "",
  applyReconnectMessagesToActiveSession,
  applySubSessionReplayMessages,
} = {}) {
  const replayGroups = takeReplayCacheGroupsForSession(replayCache, sessionId);
  for (const { dialogProcessId, turnScopeId, replayMessages } of replayGroups) {
    const isWorkflowNodeReplay = replayMessages.some((envelope) => {
      const result = validateProtocolEvent(envelope);
      return (
        result.valid &&
        result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
        Boolean(envelope.payload?.workflowRunId && envelope.payload?.nodeExecutionId)
      );
    });
    if (isWorkflowNodeReplay) {
      await applySubSessionReplayMessages?.(replayMessages, {
        rootSessionId: _trimStr(sessionId),
        dialogProcessId,
        turnScopeId,
      });
      continue;
    }
    await applyReconnectMessagesToActiveSession(replayMessages, dialogProcessId, {
      turnScopeId,
    });
  }
}

export async function applyReconnectMessagesToActiveSessionReplay({
  activeSession,
  activeSessionId,
  findCanonicalMessageById,
  findCanonicalMessagesById,
  materializeTurnPresentation,
  chatList,
  messages,
  dialogProcessId,
  turnScopeId = "",
  classifyRealtimeLog,
  envelopeCallbacks,
  navigateToLastMessage,
  processStore,
} = {}) {
  return applyReconnectReplayBatchToActiveSession({
    activeSession,
    activeSessionId,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    chatList,
    messages,
    dialogProcessId,
    turnScopeId,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
    envelopeCallbacks,
    navigateToLastMessage,
    processStore,
  });
}
