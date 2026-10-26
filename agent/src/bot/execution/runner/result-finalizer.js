/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

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
      text(message?.turnScopeId) === resolvedTurnScopeId &&
      (!text(message?.dialogProcessId) || text(message?.dialogProcessId) === text(dialogProcessId)),
  );
  const persistedTurnMessages = scopedPersistedTurnMessages.filter((message) =>
    checkpointPersistedMessageUids.has(text(message.messageUid)),
  );
  const durableTurnMessageUids = new Set(
    scopedPersistedTurnMessages.map((message) => text(message?.messageUid)).filter(Boolean),
  );
  return finalizeRunSession({
    userId,
    sessionId: usedSessionId,
    parentSessionId,
    parentDialogProcessId,
    caller,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
    thinkingStartedAt: text(resolvedRunConfig?.thinkingStartedAt),
    agentResult,
    persistedTurnMessageUids: [
      ...new Set([...checkpointPersistedMessageUids, ...durableTurnMessageUids]),
    ],
    persistedTurnMessages,
    durableTurnMessages: scopedPersistedTurnMessages,
    summaryCheckpointPromotionSources: dispatchRuntime.summaryCheckpointPromotionSources,
    runtimeEventListener,
    userConfig: {
      ...(userConfig && typeof userConfig === "object" ? userConfig : {}),
      ...(text(resolvedRunConfig?.memoryModel)
        ? { memoryModel: String(resolvedRunConfig.memoryModel).trim() }
        : {}),
    },
    lifecycle,
    persistenceScope,
  });
}
