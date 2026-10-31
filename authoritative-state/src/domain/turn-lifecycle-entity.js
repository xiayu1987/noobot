/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnLifecycleRecordIntegrity,
  decideTurnTransition,
  isRetryableFinalizeFailure,
  isTerminalTurnState,
  normalizeTurnContinuationSource,
  normalizeTurnFailure,
  normalizeCommandReceipts,
  normalizeTurnTerminalStatus,
} from "@noobot/session-protocol";
import {
  commitLifecycleTransition,
  decideLifecycleTransitionRequest,
  integer,
  projectLifecycleTransition,
  resolveLifecycleTransitionRequest,
} from "./turn-lifecycle-transition.js";
import { isPlainObject, text as clean } from "@noobot/shared/value";

function turnVersion(value, field, turnScopeId) {
  if (Number.isInteger(value) && value >= 1) return value;
  throw Object.assign(new TypeError(`turn ${field} must be a positive integer`), {
    code: "TURN_LIFECYCLE_VERSION_INVALID",
    turnScopeId,
    field,
  });
}

function normalizeFinalizeIntent(value) {
  if (!isPlainObject(value)) return null;
  return {
    type: clean(value.type),
    commandId: clean(value.commandId),
    retryable: value.retryable !== false,
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
    payload: isPlainObject(value.payload) ? { ...value.payload } : {},
  };
}

function normalizeTurn(value) {
  const turnScopeId = value.turnScopeId;
  return {
    turnScopeId,
    presentationMessageId: clean(value.presentationMessageId),
    executionId: clean(value.executionId),
    executionKind: clean(value.executionKind).toLowerCase(),
    parentExecutionId: clean(value.parentExecutionId),
    rootExecutionId: clean(value.rootExecutionId),
    origin: isPlainObject(value.origin) ? { ...value.origin } : {},
    stage: clean(value.stage),
    dialogProcessId: value.dialogProcessId,
    commandId: clean(value.commandId),
    action: clean(value.action),
    state: clean(value.state),
    phase: clean(value.phase),
    executionState: clean(value.executionState).toLowerCase(),
    revision: turnVersion(value.revision, "revision", turnScopeId),
    sequence: turnVersion(value.sequence, "sequence", turnScopeId),
    summaryVersion: integer(value.summaryVersion),
    completionCommitId: clean(value.completionCommitId),
    terminalStatus: normalizeTurnTerminalStatus(value.terminalStatus),
    failure: normalizeTurnFailure(value.failure),
    finalizeIntent: normalizeFinalizeIntent(value.finalizeIntent),
    continuationSource: normalizeTurnContinuationSource(value.continuationSource),
    continuedByTurnScopeId: clean(value.continuedByTurnScopeId),
    startedAt: clean(value.startedAt),
    finishedAt: clean(value.finishedAt),
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
  };
}

function normalizeReplacedTurn(value) {
  const turnScopeId = value.turnScopeId;
  const replacementTurnScopeId = clean(value.replacementTurnScopeId);
  const commandId = clean(value.commandId);
  return {
    turnScopeId,
    replacementDialogProcessId: clean(value.replacementDialogProcessId),
    replacementTurnScopeId,
    replacementUserMessageUid: clean(value.replacementUserMessageUid),
    requestHash: clean(value.requestHash),
    commandId,
    committedAggregateVersion: integer(value.committedAggregateVersion),
    replacedTurnScopeIds: [
      ...new Set(
        (Array.isArray(value.replacedTurnScopeIds) ? value.replacedTurnScopeIds : [turnScopeId])
          .map(clean)
          .filter(Boolean),
      ),
    ],
    sequence: integer(value.sequence),
    committedAt: clean(value.committedAt),
  };
}

function normalizeRecord(source, projector) {
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    output[key] = projector(value);
  }
  return output;
}

export function normalizeTurnLifecycleEntity(source) {
  assertTurnLifecycleRecordIntegrity(source);
  const turns = normalizeRecord(source.turns, normalizeTurn);
  const replacedTurns = normalizeRecord(source.replacedTurns, normalizeReplacedTurn);
  const commandReceipts = normalizeCommandReceipts(source.commandReceipts);
  const activeTurnScopeId = clean(source.activeTurnScopeId);
  return {
    activeTurnScopeId:
      turns[activeTurnScopeId] &&
      (!isTerminalTurnState(turns[activeTurnScopeId].state) ||
        isRetryableFinalizeFailure(turns[activeTurnScopeId]))
        ? activeTurnScopeId
        : "",
    sequence: source.sequence,
    turns,
    replacedTurns,
    commandReceipts,
  };
}

function rejectionResult(request, decision) {
  const result = {
    applied: false,
    reason: decision.reason,
    lifecycle: request.lifecycle,
  };
  if (decision.reason === "turn_replaced") {
    result.replacement = request.lifecycle.replacedTurns[request.turnScopeId];
  }
  if (decision.reason === "turn_revision_conflict") {
    result.currentRevision = request.current ? request.current.revision : 0;
  }
  if (decision.deduplicated) {
    result.deduplicated = true;
    result.receipt = decision.idempotency.receipt;
    result.turn = request.lifecycle.turns[decision.idempotency.receipt.turnScopeId];
  }
  return result;
}

export function transitionTurnLifecycle(source, input = {}, now = () => new Date().toISOString()) {
  const lifecycle = normalizeTurnLifecycleEntity(source);
  const turnScopeId = clean(input.turnScopeId);
  const current = lifecycle.turns[turnScopeId] || null;
  const request = resolveLifecycleTransitionRequest(lifecycle, input, current);
  const decision = decideLifecycleTransitionRequest(request);
  if (!decision.allowed) return rejectionResult(request, decision);
  const transition = decideTurnTransition({
    current,
    eventType: request.eventType,
    phase: request.phase,
  });
  if (!transition.allowed) return rejectionResult(request, transition);
  const nowValue = now();
  const projection = projectLifecycleTransition(request, transition, nowValue);
  return commitLifecycleTransition(request, projection, decision.requestHash, nowValue);
}
