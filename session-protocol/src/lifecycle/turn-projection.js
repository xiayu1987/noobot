/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { normalizeExecutionIdentity } from "../execution-lifecycle.js";
import {
  requireCanonicalTurnScopeId,
  requireOptionalCanonicalTurnScopeId,
} from "../identity/turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./turn-capability.js";
import { normalizeTurnContinuationSource } from "./turn-continuation.js";
import { normalizeTurnFailure } from "./turn-failure.js";
import { normalizeTurnTerminalStatus } from "./turn-terminal.js";

export function snapshotTurn(turn) {
  const executionIdentity = normalizeExecutionIdentity(turn);
  return {
    ...executionIdentity,
    turnScopeId: requireCanonicalTurnScopeId(turn.turnScopeId),
    presentationMessageId: clean(turn.presentationMessageId),
    dialogProcessId: turn.dialogProcessId,
    commandId: clean(turn.commandId),
    action: clean(turn.action),
    state: turn.state,
    phase: clean(turn.phase),
    executionState: clean(turn.executionState).toLowerCase(),
    revision: turn.revision,
    sequence: turn.sequence,
    summaryVersion: turn.summaryVersion,
    completionCommitId: clean(turn.completionCommitId),
    terminalStatus: normalizeTurnTerminalStatus(turn.terminalStatus),
    failure: normalizeTurnFailure(turn.failure),
    finalizeIntent:
      turn.finalizeIntent && typeof turn.finalizeIntent === "object" ? turn.finalizeIntent : null,
    continuationSource: normalizeTurnContinuationSource(turn.continuationSource),
    continuedByTurnScopeId: requireOptionalCanonicalTurnScopeId(turn.continuedByTurnScopeId),
    startedAt: clean(turn.startedAt),
    finishedAt: clean(turn.finishedAt),
    thinkingFinishedAt: clean(turn.thinkingFinishedAt),
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
    createdAt: clean(turn.createdAt),
    updatedAt: clean(turn.updatedAt),
  };
}

export function snapshotReplacedTurn(replacement) {
  return {
    turnScopeId: requireCanonicalTurnScopeId(replacement.turnScopeId),
    replacementDialogProcessId: clean(replacement.replacementDialogProcessId),
    replacementTurnScopeId: requireCanonicalTurnScopeId(replacement.replacementTurnScopeId),
    replacementUserMessageUid: clean(replacement.replacementUserMessageUid),
    requestHash: clean(replacement.requestHash),
    commandId: clean(replacement.commandId),
    committedAggregateVersion: replacement.committedAggregateVersion,
    replacedTurnScopeIds: replacement.replacedTurnScopeIds.map(requireCanonicalTurnScopeId),
    sequence: replacement.sequence,
    committedAt: clean(replacement.committedAt),
  };
}
