/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../events/index.js";
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
  const finalizeThinkingStartedAt = text(resolvedRunConfig?.thinkingStartedAt);
  emitEvent(runtimeEventListener, "debug_resend_runner_finalize", {
    resolvedThinkingStartedAt: finalizeThinkingStartedAt,
  });
  const checkpointPersistedTotal = Math.max(
    0,
    Number(dispatchRuntime?.summaryCheckpointPersistedTotal) || 0,
  );
  const durableCheckpointState = await getTurnSummaryCheckpointState({
    userId,
    sessionId: usedSessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
    persistenceScope,
  });
  const durablePersistedMessageUids = (
    Array.isArray(durableCheckpointState?.receipts) ? durableCheckpointState.receipts : []
  ).flatMap((receipt) =>
    Array.isArray(receipt?.persistedMessageUids) ? receipt.persistedMessageUids : [],
  );
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
      .map((uid) => text(uid))
      .filter(Boolean),
  );

  const persistedSessionMessages = await getSessionTurns({
    userId,
    sessionId: usedSessionId,
    parentSessionId,
    persistenceScope,
  });
  const scopedPersistedTurnMessages = persistedSessionMessages.filter(
    (message) =>
      text(message?.turnScopeId) === resolvedTurnScopeId &&
      (!text(message?.dialogProcessId) || text(message?.dialogProcessId) === text(dialogProcessId)),
  );
  const persistedTurnMessages =
    checkpointPersistedMessageUids.size > 0
      ? scopedPersistedTurnMessages.filter((message) =>
          checkpointPersistedMessageUids.has(text(message?.messageUid)),
        )
      : checkpointPersistedTotal > 0
        ? scopedPersistedTurnMessages.slice(-checkpointPersistedTotal)
        : [];
  const durableTurnMessageUids = new Set(
    scopedPersistedTurnMessages.map((message) => text(message?.messageUid)).filter(Boolean),
  );
  let recoveredActivePrefixCount = 0;
  for (const message of Array.isArray(agentResult?.turnMessages) ? agentResult.turnMessages : []) {
    const messageUid = text(message?.messageUid);
    if (!messageUid || !checkpointPersistedMessageUids.has(messageUid)) break;
    recoveredActivePrefixCount += 1;
  }
  return finalizeRunSession({
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
    persistedTurnMessageUids: [
      ...new Set([...checkpointPersistedMessageUids, ...durableTurnMessageUids]),
    ],
    persistedTurnMessages,
    durableTurnMessages: scopedPersistedTurnMessages,
    summaryCheckpointPromotionSources: Array.isArray(
      dispatchRuntime?.summaryCheckpointPromotionSources,
    )
      ? dispatchRuntime.summaryCheckpointPromotionSources
      : [],
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
