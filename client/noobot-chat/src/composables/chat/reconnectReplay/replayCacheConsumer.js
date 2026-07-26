/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
} from "../../infra/reconnectReplayModel";
import {
  markReconnectSequenceApplied as markReconnectSequenceAppliedInCache,
  normalizeReplayCacheKey,
  takeReplayCacheGroupsForSession,
} from "./replayCache";
import {
  applyReconnectReplayBatchToActiveSession,
} from "./messageReplay";
import {
  _trimStr,
  normalizeExecutionLogForRealtime,
} from "./utils";

export async function consumeReconnectReplayCacheForSession({
  replayCache,
  sessionId = "",
  applyReconnectMessagesToActiveSession,
  applySubSessionReplayMessages,
} = {}) {
  const replayGroups = takeReplayCacheGroupsForSession(replayCache, sessionId);
  for (const { dialogProcessId, turnScopeId, replayMessages } of replayGroups) {
    const isWorkflowNodeReplay = _trimStr(turnScopeId).startsWith("workflow-node:") ||
      replayMessages.some(({ event = "", data = {} } = {}) =>
        event === "subagent_message_event" ||
        data?.route?.scope === "sub_session" ||
        _trimStr(data?.event?.turnScopeId || data?.turnScopeId).startsWith("workflow-node:"));
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
      ...(!turnScopeId ? { legacyDialogFallback: true } : {}),
    });
  }
}

export function markReconnectSequenceApplied(
  appliedReconnectSeqByDialogProcessId,
  dialogProcessId = "",
  sequence = 0,
  identity = {},
) {
  markReconnectSequenceAppliedInCache(
    appliedReconnectSeqByDialogProcessId,
    dialogProcessId,
    sequence,
    identity,
  );
}

export async function applyReconnectMessagesToActiveSessionReplay({
  activeSession,
  activeSessionId,
  appendMessage,
  chatList,
  messages,
  dialogProcessId,
  turnScopeId = "",
  allowCreate = true,
  authoritativeCurrentRun = false,
  legacyDialogFallback = false,
  appliedReconnectSeqByDialogProcessId,
  terminalDialogProcessIdSet,
  classifyRealtimeLog,
  getReplayHydrationPromise,
  setReplayHydrationPromise,
  applyDoneMessages,
  envelopeCallbacks,
  markReconnectSequenceApplied: markSequenceApplied,
  navigateToLastMessage,
  processStore,
  onHydrationError,
} = {}) {
  return applyReconnectReplayBatchToActiveSession({
    activeSession,
    activeSessionId,
    appendMessage,
    chatList,
    messages,
    dialogProcessId,
    turnScopeId,
    allowCreate,
    authoritativeCurrentRun,
    legacyDialogFallback: legacyDialogFallback || !_trimStr(turnScopeId),
    lastAppliedSeq: Number(appliedReconnectSeqByDialogProcessId[
      normalizeReplayCacheKey(dialogProcessId, activeSessionId?.value, turnScopeId)
    ] || appliedReconnectSeqByDialogProcessId[_trimStr(dialogProcessId)] || 0),
    terminalDialogProcessIdSet,
    isReconnectTerminalBatch,
    isReconnectTerminalEvent,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
    getReplayHydrationPromise,
    setReplayHydrationPromise,
    onHydrationError,
    applyDoneMessages,
    envelopeCallbacks,
    markReconnectSequenceApplied: markSequenceApplied,
    navigateToLastMessage,
    processStore,
  });
}
