/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../../event/index.js";

export async function finalizeAgentTurn({
  resolvedRunConfig, runtimeEventListener, usedSessionId, dialogProcessId,
  resolvedTurnScopeId, dispatchRuntime, getSessionTurns, finalizeRunSession,
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
const persistedSessionMessages = checkpointPersistedTotal > 0 &&
  typeof getSessionTurns === "function"
  ? await getSessionTurns({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      persistenceContext,
    })
  : [];
const persistedTurnMessages = persistedSessionMessages
  .filter((message) => String(message?.turnScopeId || "").trim() === resolvedTurnScopeId)
  .slice(-checkpointPersistedTotal);
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
    0,
    Number(dispatchRuntime?.summaryCheckpointPersistedCount) || 0,
  ),
  persistedTurnMessages,
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
