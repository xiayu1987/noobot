/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function finalizeAgentTurn({
  resolvedRunConfig,
  runtimeEventListener,
  usedSessionId,
  dialogProcessId,
  resolvedTurnScopeId,
  dispatchRuntime,
  getSessionTurns,
  getTurnSummaryCheckpointState,
  finalizeRunSession,
  userId,
  parentSessionId,
  parentDialogProcessId,
  caller,
  agentResult,
  userConfig,
  lifecycle,
  persistenceScope,
}) {
  const durableCheckpointState = await getTurnSummaryCheckpointState({
    userId,
    sessionId: usedSessionId,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
    persistenceScope,
  });
  const checkpointPersistedMessageUids = new Set([
    ...dispatchRuntime.timelineCheckpointPersistedMessageUids,
    ...dispatchRuntime.summaryCheckpointPersistedMessageUids,
    ...durableCheckpointState.receipts.flatMap((receipt) => receipt.persistedMessageUids),
  ]);

  const persistedSessionMessages = await getSessionTurns({
    userId,
    sessionId: usedSessionId,
    persistenceScope,
  });
  const scopedPersistedTurnMessages = persistedSessionMessages.filter(
    (message) =>
      message.turnScopeId === resolvedTurnScopeId && message.dialogProcessId === dialogProcessId,
  );
  const persistedTurnMessages = scopedPersistedTurnMessages.filter((message) =>
    checkpointPersistedMessageUids.has(message.messageUid),
  );
  const durableTurnMessageUids = new Set(
    scopedPersistedTurnMessages.map((message) => message.messageUid),
  );
  return finalizeRunSession({
    userId,
    sessionId: usedSessionId,
    parentSessionId,
    parentDialogProcessId,
    caller,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
    thinkingStartedAt: resolvedRunConfig.thinkingStartedAt,
    agentResult,
    persistedTurnMessageUids: [
      ...new Set([...checkpointPersistedMessageUids, ...durableTurnMessageUids]),
    ],
    persistedTurnMessages,
    durableTurnMessages: scopedPersistedTurnMessages,
    summaryCheckpointPromotionSources: dispatchRuntime.summaryCheckpointPromotionSources,
    runtimeEventListener,
    userConfig: {
      ...userConfig,
      ...(resolvedRunConfig.memoryModel ? { memoryModel: resolvedRunConfig.memoryModel } : {}),
    },
    lifecycle,
    persistenceScope,
  });
}
