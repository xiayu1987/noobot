/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

export async function finalizeAgentTurn({
  startedAt,
  resolvedRunConfig,
  runtimeEventListener,
  usedSessionId,
  dialogProcessId,
  resolvedTurnScopeId,
  dispatchRuntime,
  userMessageUid,
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
    readResultTransfers() {
      const sources = [
        ...dispatchRuntime.summaryCheckpointPromotionSources,
        ...dispatchRuntime.currentTurnMessages.readArtifactProjectionSources(),
      ];
      return mergeTransferEnvelopes(
        ...sources
          .filter((message) => message.messageUid !== userMessageUid)
          .map((message) => message.transferEnvelopes),
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
