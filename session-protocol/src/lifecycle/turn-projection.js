/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXECUTION_KIND, normalizeExecutionIdentity } from "../execution-lifecycle.js";
import { canonicalizeTurnScopeId } from "../identity/turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./turn-capability.js";
import { normalizeTurnContinuationSource } from "./turn-continuation.js";
import { text as clean } from "../normalize.js";

export function snapshotTurn(turn = {}) {
  const executionIdentity = normalizeExecutionIdentity({
    ...turn,
    executionKind: turn.executionKind || EXECUTION_KIND.AGENT,
  });
  return {
    ...executionIdentity,
    turnScopeId: canonicalizeTurnScopeId(turn.turnScopeId),
    messageId: clean(turn.messageId),
    presentationMessageId: clean(turn.presentationMessageId),
    dialogProcessId: clean(turn.dialogProcessId),
    commandId: clean(turn.commandId),
    action: clean(turn.action),
    state: clean(turn.state),
    phase: clean(turn.phase),
    executionState: clean(turn.executionState).toLowerCase(),
    revision: Number(turn.revision || 0),
    sequence: Number(turn.sequence || 0),
    summaryVersion: Number(turn.summaryVersion || 0),
    completionCommitId: clean(turn.completionCommitId),
    terminalStatus:
      turn.terminalStatus && typeof turn.terminalStatus === "object" ? turn.terminalStatus : null,
    failure: turn.failure && typeof turn.failure === "object" ? turn.failure : null,
    finalizeIntent:
      turn.finalizeIntent && typeof turn.finalizeIntent === "object" ? turn.finalizeIntent : null,
    continuationSource: normalizeTurnContinuationSource(turn.continuationSource),
    continuedByTurnScopeId: canonicalizeTurnScopeId(turn.continuedByTurnScopeId),
    startedAt: clean(turn.startedAt),
    finishedAt: clean(turn.finishedAt),
    thinkingStartedAt: clean(turn.thinkingStartedAt),
    thinkingFinishedAt: clean(turn.thinkingFinishedAt),
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
    createdAt: clean(turn.createdAt),
    updatedAt: clean(turn.updatedAt),
  };
}

export function snapshotReplacedTurn(replacement = {}) {
  return {
    turnScopeId: canonicalizeTurnScopeId(replacement.turnScopeId),
    replacementDialogProcessId: clean(replacement.replacementDialogProcessId),
    replacementTurnScopeId: canonicalizeTurnScopeId(replacement.replacementTurnScopeId),
    replacementUserMessageId: clean(replacement.replacementUserMessageId),
    requestHash: clean(replacement.requestHash),
    commandId: clean(replacement.commandId),
    committedAggregateVersion: Number(replacement.committedAggregateVersion || 0),
    replacedTurnScopeIds: [
      ...new Set(
        (Array.isArray(replacement.replacedTurnScopeIds)
          ? replacement.replacedTurnScopeIds
          : [replacement.turnScopeId]
        )
          .map(canonicalizeTurnScopeId)
          .filter(Boolean),
      ),
    ],
    sequence: Number(replacement.sequence || 0),
    committedAt: clean(replacement.committedAt),
  };
}
