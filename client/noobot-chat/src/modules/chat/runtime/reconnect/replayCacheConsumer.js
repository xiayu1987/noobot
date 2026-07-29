/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
} from "../../model/reconnectReplayModel.js";
import {
  markReconnectSequenceApplied as markReconnectSequenceAppliedInCache,
  normalizeReplayCacheKey,
  takeReplayCacheGroupsForSession,
} from "./replayCache.js";
import {
  applyReconnectReplayBatchToActiveSession,
} from "./messageReplay.js";
import {
  _trimStr,
  normalizeExecutionLogForRealtime,
} from "./utils.js";

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
  findCanonicalMessageById,
  chatList,
  messages,
  dialogProcessId,
  turnScopeId = "",
  appliedReconnectSeqByDialogProcessId,
  appliedReconnectEventKindsByTurnKey,
  terminalDialogProcessIdSet,
  classifyRealtimeLog,
  envelopeCallbacks,
  markReconnectSequenceApplied: markSequenceApplied,
  navigateToLastMessage,
  processStore,
} = {}) {
  const replayKey = normalizeReplayCacheKey(dialogProcessId, activeSessionId?.value, turnScopeId);
  const lastAppliedSeq = Number(
    appliedReconnectSeqByDialogProcessId[replayKey] ||
    appliedReconnectSeqByDialogProcessId[_trimStr(dialogProcessId)] ||
    0,
  );
  const boundary = appliedReconnectEventKindsByTurnKey?.[replayKey] ||
    appliedReconnectEventKindsByTurnKey?.[_trimStr(dialogProcessId)] || null;
  return applyReconnectReplayBatchToActiveSession({
    activeSession,
    activeSessionId,
    findCanonicalMessageById,
    chatList,
    messages,
    dialogProcessId,
    turnScopeId,
    lastAppliedSeq,
    lastAppliedEventKinds: boundary && Number(boundary.sequence || 0) === lastAppliedSeq
      ? boundary.eventKinds
      : null,
    terminalDialogProcessIdSet,
    isReconnectTerminalBatch,
    isReconnectTerminalEvent,
    classifyRealtimeLog,
    normalizeExecutionLogForRealtime,
    envelopeCallbacks,
    markReconnectSequenceApplied: markSequenceApplied,
    navigateToLastMessage,
    processStore,
  });
}
