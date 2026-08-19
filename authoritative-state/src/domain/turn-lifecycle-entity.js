/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  decideTurnTransition,
  isRetryableFinalizeFailure,
  isTerminalTurnState,
  normalizeTurnContinuationSource,
  normalizeCommandReceipts,
  projectTurnTiming,
} from "@noobot/session-protocol";
import { validateProtocolEvent, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  commitLifecycleTransition,
  decideLifecycleTransitionRequest,
  projectLifecycleTransition,
  resolveLifecycleTransitionRequest,
} from "./turn-lifecycle-transition.js";

const clean = (value) => String(value || "").trim();
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

function normalizeFinalizeIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    type: clean(value.type),
    commandId: clean(value.commandId),
    retryable: value.retryable !== false,
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
    payload:
      value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
        ? { ...value.payload }
        : {},
  };
}

function normalizeTurn(value, key) {
  const turnScopeId = clean(value.turnScopeId || key);
  if (!turnScopeId) return null;
  return {
    turnScopeId,
    messageId: clean(value.messageId),
    presentationMessageId: clean(value.presentationMessageId),
    executionId: clean(value.executionId) || `agent:${turnScopeId}`,
    executionKind: clean(value.executionKind) || "agent",
    parentExecutionId: clean(value.parentExecutionId),
    rootExecutionId:
      clean(value.rootExecutionId) || clean(value.executionId) || `agent:${turnScopeId}`,
    origin:
      value.origin && typeof value.origin === "object" && !Array.isArray(value.origin)
        ? { ...value.origin }
        : {},
    stage: clean(value.stage),
    dialogProcessId: clean(value.dialogProcessId),
    commandId: clean(value.commandId),
    action: clean(value.action),
    state: clean(value.state),
    phase: clean(value.phase),
    executionState: clean(value.executionState).toLowerCase(),
    revision: integer(value.revision),
    sequence: integer(value.sequence),
    summaryVersion: integer(value.summaryVersion),
    completionCommitId: clean(value.completionCommitId),
    terminalStatus:
      value.terminalStatus &&
      typeof value.terminalStatus === "object" &&
      !Array.isArray(value.terminalStatus)
        ? { ...value.terminalStatus }
        : null,
    failure:
      value.failure && typeof value.failure === "object" && !Array.isArray(value.failure)
        ? { ...value.failure, phase: clean(value.failure.phase || value.phase) }
        : null,
    finalizeIntent: normalizeFinalizeIntent(value.finalizeIntent),
    continuationSource: normalizeTurnContinuationSource(value.continuationSource),
    continuedByTurnScopeId: clean(value.continuedByTurnScopeId),
    startedAt: clean(value.startedAt),
    finishedAt: clean(value.finishedAt),
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
  };
}

function normalizeReplacedTurn(value, key) {
  const turnScopeId = clean(value.turnScopeId || key);
  const replacementTurnScopeId = clean(value.replacementTurnScopeId);
  const commandId = clean(value.commandId);
  if (!turnScopeId || !replacementTurnScopeId || !commandId) return null;
  return {
    turnScopeId,
    replacementDialogProcessId: clean(value.replacementDialogProcessId),
    replacementTurnScopeId,
    replacementUserMessageId: clean(value.replacementUserMessageId),
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

function normalizeCommandReceipt(item) {
  const eventId = clean(item.eventId);
  const envelope =
    item.envelope && typeof item.envelope === "object" && !Array.isArray(item.envelope)
      ? item.envelope
      : null;
  const validation = validateProtocolEvent(envelope || {});
  return {
    ...item,
    commandId: clean(item.commandId),
    type: clean(item.type),
    turnScopeId: clean(item.turnScopeId),
    requestHash: clean(item.requestHash),
    aggregateVersion: integer(item.aggregateVersion),
    result:
      item.result && typeof item.result === "object" && !Array.isArray(item.result)
        ? structuredClone(item.result)
        : {},
    revision: integer(item.revision),
    sequence: integer(item.sequence),
    committedAt: clean(item.committedAt),
    eventId,
    envelope:
      validation.valid &&
      validation.descriptor?.family === EVENT_FAMILY.TURN_LIFECYCLE &&
      clean(envelope?.identity?.eventId) === eventId
        ? envelope
        : null,
  };
}

function normalizeRecord(source, projector) {
  const output = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const projected = projector(value, key);
    if (projected) output[projected.turnScopeId] = projected;
  }
  return output;
}

export function normalizeTurnLifecycleEntity(source = {}) {
  const turns = normalizeRecord(source.turns, normalizeTurn);
  const replacedTurns = normalizeRecord(source.replacedTurns, normalizeReplacedTurn);
  const commandReceipts = normalizeCommandReceipts(source.commandReceipts).map(
    normalizeCommandReceipt,
  );
  const activeTurnScopeId = clean(source.activeTurnScopeId);
  return {
    activeTurnScopeId:
      turns[activeTurnScopeId] &&
      (!isTerminalTurnState(turns[activeTurnScopeId].state) ||
        isRetryableFinalizeFailure(turns[activeTurnScopeId]))
        ? activeTurnScopeId
        : "",
    sequence: Math.max(
      integer(source.sequence),
      ...Object.values(turns).map((turn) => turn.sequence),
      ...Object.values(replacedTurns).map((turn) => turn.sequence),
    ),
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
    result.currentRevision = Number(request.current?.revision || 0);
  }
  if (decision.deduplicated) {
    result.deduplicated = true;
    result.turn = request.lifecycle.turns[decision.idempotency.receipt.turnScopeId];
  }
  return result;
}

export function transitionTurnLifecycle(
  source = {},
  input = {},
  now = () => new Date().toISOString(),
) {
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

export function isTerminalTurnLifecycleState(state) {
  return isTerminalTurnState(state);
}

export function projectTurnLifecycleTiming(turn = {}, turnTimings = []) {
  return projectTurnTiming(turn, turnTimings);
}
