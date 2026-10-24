/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { normalizeExecutionIdentity } from "../execution-lifecycle.js";
import { canonicalizeTurnScopeId } from "../identity/turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./turn-capability.js";
import { normalizeTurnContinuationSource } from "./turn-continuation.js";
import { normalizeTurnFailure } from "./turn-failure.js";
import { normalizeTurnTerminalStatus } from "./turn-terminal.js";

export function snapshotTurn(turn = {}) {
  const executionIdentity = normalizeExecutionIdentity(turn);
  return {
    ...executionIdentity,
    turnScopeId: canonicalizeTurnScopeId(turn.turnScopeId),
    presentationMessageId: clean(turn.presentationMessageId),
    dialogProcessId: turn.dialogProcessId,
    commandId: clean(turn.commandId),
    action: clean(turn.action),
    state: turn.state,
    phase: clean(turn.phase),
    executionState: clean(turn.executionState).toLowerCase(),
    revision: turn.revision,
    sequence: turn.sequence,
    summaryVersion: Number(turn.summaryVersion || 0),
    completionCommitId: clean(turn.completionCommitId),
    terminalStatus: normalizeTurnTerminalStatus(turn.terminalStatus),
    failure: normalizeTurnFailure(turn.failure),
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
    replacementUserMessageUid: clean(replacement.replacementUserMessageUid),
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
