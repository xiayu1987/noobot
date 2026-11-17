/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function finalizeAgentTurn({
  startedAt,
  resolvedRunConfig,
  runtimeEventListener,
  usedSessionId,
  dialogProcessId,
  resolvedTurnScopeId,
  dispatchRuntime,
  userMessageUid,
  getSessionTurns,
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
  const turnPersistence = {
    flush: () => dispatchRuntime.persistCurrentTurnMessages(),
    async readResultMessages() {
      const messages = await getSessionTurns({
        userId,
        sessionId: usedSessionId,
        turnScopeId: resolvedTurnScopeId,
        dialogProcessId,
        persistenceScope,
      });
      return messages.filter(
        (message) =>
          message.turnScopeId === resolvedTurnScopeId &&
          message.dialogProcessId === dialogProcessId &&
          message.messageUid !== userMessageUid,
      );
    },
  };
  return finalizeRunSession({
    userId,
    sessionId: usedSessionId,
    parentSessionId,
    parentDialogProcessId,
    caller,
    dialogProcessId,
    turnScopeId: resolvedTurnScopeId,
    startedAt,
    agentResult,
    turnPersistence,
    runtimeEventListener,
    userConfig: {
      ...userConfig,
      ...(resolvedRunConfig.memoryModel ? { memoryModel: resolvedRunConfig.memoryModel } : {}),
    },
    lifecycle,
    persistenceScope,
  });
}
