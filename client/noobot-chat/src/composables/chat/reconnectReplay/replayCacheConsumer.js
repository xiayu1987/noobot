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
  for (const { dialogProcessId, replayMessages } of replayGroups) {
    await applyReconnectMessagesToActiveSession(replayMessages, dialogProcessId);
  }
}

export function markReconnectSequenceApplied(
  appliedReconnectSeqByDialogProcessId,
  dialogProcessId = "",
  sequence = 0,
) {
  markReconnectSequenceAppliedInCache(
    appliedReconnectSeqByDialogProcessId,
    dialogProcessId,
    sequence,
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
    lastAppliedSeq: Number(appliedReconnectSeqByDialogProcessId[_trimStr(dialogProcessId)] || 0),
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
