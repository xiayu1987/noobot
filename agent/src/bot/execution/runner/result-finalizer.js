/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../events/index.js";

export async function finalizeAgentTurn({
  resolvedRunConfig, runtimeEventListener, usedSessionId, dialogProcessId,
  resolvedTurnScopeId, dispatchRuntime, getSessionTurns, getTurnSummaryCheckpointState, finalizeRunSession,
  userId, parentSessionId, parentDialogProcessId, caller, agentResult,
  executionStartIndex, userConfig, resolvedParentAsyncResultContainer, lifecycle,
  persistenceContext,
}) {
const finalizeThinkingStartedAt = String(resolvedRunConfig?.thinkingStartedAt || "").trim();
emitEvent(runtimeEventListener, "debug_resend_runner_finalize", {
  sessionId: usedSessionId,
  dialogProcessId,
  turnScopeId: resolvedTurnScopeId,
  resolvedThinkingStartedAt: finalizeThinkingStartedAt,
});
const checkpointPersistedTotal = Math.max(
  0,
  Number(dispatchRuntime?.summaryCheckpointPersistedTotal) || 0,
);
const durableCheckpointState = typeof getTurnSummaryCheckpointState === "function"
  ? await getTurnSummaryCheckpointState({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      dialogProcessId,
      turnScopeId: resolvedTurnScopeId,
      persistenceContext,
    })
  : null;
const durablePersistedMessageUids = (Array.isArray(durableCheckpointState?.receipts)
  ? durableCheckpointState.receipts
  : []).flatMap((receipt) => Array.isArray(receipt?.persistedMessageUids)
    ? receipt.persistedMessageUids
    : []);
const checkpointPersistedMessageUids = new Set(
  [
    ...(Array.isArray(dispatchRuntime?.timelineCheckpointPersistedMessageUids)
      ? dispatchRuntime.timelineCheckpointPersistedMessageUids
      : []),
    ...(Array.isArray(dispatchRuntime?.summaryCheckpointPersistedMessageUids)
      ? dispatchRuntime.summaryCheckpointPersistedMessageUids
      : []),
    ...durablePersistedMessageUids,
  ]
    .map((uid) => String(uid || "").trim())
    .filter(Boolean),
);
// Finalization must compare the complete durable turn even when no summary
// checkpoint exists. Summary policy mutates already-persisted messages in
// memory, so suffix-only persistence would lose those canonical state changes.
const persistedSessionMessagesResult = typeof getSessionTurns === "function"
  ? await getSessionTurns({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      persistenceContext,
    })
  : [];
const persistedSessionMessages = Array.isArray(persistedSessionMessagesResult)
  ? persistedSessionMessagesResult
  : [];
const scopedPersistedTurnMessages = persistedSessionMessages.filter((message) =>
  String(message?.turnScopeId || "").trim() === resolvedTurnScopeId &&
  (!String(message?.dialogProcessId || "").trim() ||
    String(message?.dialogProcessId || "").trim() === String(dialogProcessId || "").trim()));
const persistedTurnMessages = checkpointPersistedMessageUids.size > 0
  ? scopedPersistedTurnMessages.filter((message) =>
      checkpointPersistedMessageUids.has(String(message?.messageUid || "").trim()))
  : checkpointPersistedTotal > 0
    ? scopedPersistedTurnMessages.slice(-checkpointPersistedTotal)
    : [];
const durableTurnMessageUids = new Set(
  scopedPersistedTurnMessages
    .map((message) => String(message?.messageUid || "").trim())
    .filter(Boolean),
);
let recoveredActivePrefixCount = 0;
for (const message of Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : []) {
  const messageUid = String(message?.messageUid || "").trim();
  if (!messageUid || !checkpointPersistedMessageUids.has(messageUid)) break;
  recoveredActivePrefixCount += 1;
}
const finalizedResult = await finalizeRunSession({
  userId,
  sessionId: usedSessionId,
  parentSessionId,
  parentDialogProcessId,
  caller,
  dialogProcessId,
  turnScopeId: resolvedTurnScopeId,
  thinkingStartedAt: finalizeThinkingStartedAt,
  agentResult,
  alreadyPersistedTurnMessageCount: Math.max(
    recoveredActivePrefixCount,
    0,
    Number(dispatchRuntime?.summaryCheckpointPersistedCount) || 0,
  ),
  persistedTurnMessageUids: [...new Set([
    ...checkpointPersistedMessageUids,
    ...durableTurnMessageUids,
  ])],
  persistedTurnMessages,
  durableTurnMessages: scopedPersistedTurnMessages,
  summaryCheckpointPromotionSources: Array.isArray(
    dispatchRuntime?.summaryCheckpointPromotionSources,
  )
    ? dispatchRuntime.summaryCheckpointPromotionSources
    : [],
  executionStartIndex,
  runtimeEventListener,
  userConfig: {
    ...(userConfig && typeof userConfig === "object" ? userConfig : {}),
    ...(String(resolvedRunConfig?.memoryModel || "").trim()
      ? { memoryModel: String(resolvedRunConfig.memoryModel).trim() }
      : {}),
  },
  resolvedParentAsyncResultContainer,
  lifecycle,
  persistenceContext,
});
emitEvent(runtimeEventListener, "agent_done", {
  sessionId: usedSessionId,
  traceCount: agentResult?.traces?.length || 0,
});
  return finalizedResult;
}
