/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildExecutionTree,
  projectExecutionRecord,
} from "@noobot/session-protocol/execution-lifecycle";
import {
  createTurnLifecycleSnapshot,
  createTurnTerminalResolution,
  isTurnSnapshotKnownSequence,
  isTurnSnapshotTerminalLimit,
} from "@noobot/session-protocol/turn-lifecycle";
import { isTerminalTurnState, projectTurnTiming } from "@noobot/session-protocol";
import { normalizeTurnLifecycleEntity } from "../domain/turn-lifecycle-entity.js";
import { text as clean } from "@noobot/shared/value";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

function selectLifecycleActiveTurn(lifecycle) {
  return lifecycle.turns[lifecycle.activeTurnScopeId] ?? null;
}

export function selectAuthoritativeActiveTurn(lifecycleSource) {
  return selectLifecycleActiveTurn(normalizeTurnLifecycleEntity(lifecycleSource));
}

export function createAuthoritativeTurnSnapshot({
  lifecycle: lifecycleSource,
  turnTimings,
  commandId,
  sessionId,
  knownSequence,
  terminalLimit,
  terminalTurnScopeIds,
  recovery,
  generatedAt,
}) {
  if (!isTurnSnapshotKnownSequence(knownSequence)) {
    throw new TypeError("turn_snapshot_requires_known_sequence");
  }
  if (!isTurnSnapshotTerminalLimit(terminalLimit)) {
    throw new TypeError("turn_snapshot_requires_terminal_limit");
  }
  const lifecycle = normalizeTurnLifecycleEntity(lifecycleSource);
  const terminalTurnScopes = new Set(terminalTurnScopeIds);
  const lifecycleActiveTurn = selectLifecycleActiveTurn(lifecycle);
  const activeTurn = lifecycleActiveTurn
    ? { ...projectTurnTiming(lifecycleActiveTurn, turnTimings), sessionId }
    : null;
  const recentTerminalTurns = Object.values(lifecycle.turns)
    .filter((turn) => terminalTurnScopes.has(turn.turnScopeId) && isTerminalTurnState(turn.state))
    .sort((left, right) => Number(right.sequence) - Number(left.sequence))
    .slice(0, terminalLimit)
    .map((turn) => ({ ...projectTurnTiming(turn, turnTimings), sessionId }));
  return createTurnLifecycleSnapshot({
    commandId,
    sessionId,
    sequence: lifecycle.sequence,
    activeTurnScopeId: lifecycle.activeTurnScopeId,
    activeTurn,
    recentTerminalTurns,
    replacedTurns: Object.values(lifecycle.replacedTurns),
    unchanged: knownSequence > 0 && knownSequence === lifecycle.sequence,
    recovery,
    generatedAt,
  });
}

export function resolveAuthoritativeTurnTerminal({
  lifecycle: lifecycleSource = {},
  turnTimings = [],
  commandId = "",
  sessionId = "",
  turnScopeId = "",
  aggregateVersion = null,
} = {}) {
  const retryAfterMs = TIME_THRESHOLDS.agent.terminalResolutionRetryDelayMs;
  const normalizedCommandId = clean(commandId);
  const normalizedSessionId = clean(sessionId);
  const normalizedTurnScopeId = clean(turnScopeId);
  if (!normalizedCommandId || !normalizedSessionId || !normalizedTurnScopeId) {
    throw new TypeError("terminal resolution requires commandId, sessionId and turnScopeId");
  }
  const base = {
    commandId: normalizedCommandId,
    sessionId: normalizedSessionId,
    turnScopeId: normalizedTurnScopeId,
    aggregateVersion,
  };
  const lifecycle = normalizeTurnLifecycleEntity(lifecycleSource);
  const lifecycleTurn = lifecycle.turns[normalizedTurnScopeId] || null;
  const turn = lifecycleTurn
    ? { ...projectTurnTiming(lifecycleTurn, turnTimings), sessionId: normalizedSessionId }
    : null;
  if (!turn) {
    return createTurnTerminalResolution({
      ...base,
      reason: "turn_not_found",
      retryable: true,
      retryAfterMs,
    });
  }
  if (!isTerminalTurnState(turn.state)) {
    return createTurnTerminalResolution({
      ...base,
      reason: "turn_not_terminal",
      retryable: true,
      retryAfterMs,
      turn,
    });
  }
  if (!turn.terminalStatus) {
    return createTurnTerminalResolution({
      ...base,
      reason: "terminal_status_not_ready",
      retryable: true,
      retryAfterMs,
      turn,
    });
  }
  return createTurnTerminalResolution({ ...base, resolved: true, turn });
}

export function projectAuthoritativeExecution(turn, session) {
  return projectExecutionRecord({
    ...turn,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
  });
}

export function buildAuthoritativeExecutionReadModel(sessions = []) {
  const byId = new Map();
  const conflicts = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const lifecycle = normalizeTurnLifecycleEntity(session.turnLifecycle);
    for (const turn of Object.values(lifecycle.turns)) {
      const execution = projectAuthoritativeExecution(turn, session);
      if (!execution.executionId) continue;
      if (conflicts.has(execution.executionId)) continue;
      const current = byId.get(execution.executionId);
      if (!current) {
        byId.set(execution.executionId, execution);
        continue;
      }
      conflicts.set(execution.executionId, {
        executionId: execution.executionId,
        reason: "execution_identity_conflict",
        identities: [current, execution].map((item) => ({
          executionKind: item.executionKind,
          sessionId: item.sessionId,
          parentSessionId: item.parentSessionId,
          turnScopeId: item.turnScopeId,
          parentExecutionId: item.parentExecutionId,
          rootExecutionId: item.rootExecutionId,
          origin: item.origin,
        })),
      });
      byId.delete(execution.executionId);
    }
  }
  return { executions: [...byId.values()], conflicts };
}

export function queryAuthoritativeExecution(
  readModel,
  { executionId, generatedAt = new Date().toISOString() } = {},
) {
  const id = clean(executionId);
  if (!id) return { found: false, reason: "missing_execution" };
  const conflict = readModel.conflicts.get(id);
  if (conflict) return { found: false, reason: conflict.reason, conflict };
  const execution = readModel.executions.find((item) => item.executionId === id);
  return execution
    ? { found: true, execution, generatedAt }
    : { found: false, reason: "execution_not_found" };
}

export function queryAuthoritativeExecutionTree(
  readModel,
  { executionId = "", rootExecutionId = "", generatedAt = new Date().toISOString() } = {},
) {
  const requestedExecutionId = clean(executionId);
  const requestedRootId = clean(rootExecutionId);
  const targetId = requestedExecutionId || requestedRootId;
  if (!targetId) return { found: false, reason: "missing_execution" };
  const conflict = readModel.conflicts.get(targetId);
  if (conflict) return { found: false, reason: conflict.reason, conflict };
  const selected = requestedExecutionId
    ? readModel.executions.find((item) => item.executionId === requestedExecutionId)
    : readModel.executions.find(
        (item) => item.executionId === requestedRootId || item.rootExecutionId === requestedRootId,
      );
  if (!selected) return { found: false, reason: "execution_not_found" };
  const rootId = requestedRootId || selected.rootExecutionId;
  const tree = buildExecutionTree(
    readModel.executions.filter(
      (item) => item.executionId === rootId || item.rootExecutionId === rootId,
    ),
  );
  const execution = tree.executions[requestedExecutionId || rootId];
  if (!execution) return { found: false, reason: "execution_not_found" };
  return {
    found: true,
    execution,
    rootExecutionId: rootId,
    tree,
    generatedAt,
  };
}

export function queryAuthoritativeExecutionChildren(readModel, options = {}) {
  const result = queryAuthoritativeExecutionTree(readModel, options);
  if (!result.found) return result;
  return {
    found: true,
    execution: result.execution,
    children: result.execution.childExecutionIds.map((id) => result.tree.executions[id]),
    generatedAt: result.generatedAt,
  };
}
