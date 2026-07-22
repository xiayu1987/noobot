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
} = {}) {
  const replayGroups = takeReplayCacheGroupsForSession(replayCache, sessionId);
  for (const { dialogProcessId, turnScopeId, replayMessages } of replayGroups) {
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
