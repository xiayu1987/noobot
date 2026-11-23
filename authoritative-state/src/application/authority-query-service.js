/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireSessionExecutionSource } from "@noobot/session-protocol/session-reader";
import {
  buildExecutionTree,
  EXECUTION_QUERY_COMMAND,
  EXECUTION_QUERY_IDENTITY_CONFLICT,
  EXECUTION_QUERY_MISSING_TARGET,
  isExecutionQueryTargetValid,
  isDirectExecutionChild,
  isExecutionInRoot,
  projectExecutionRecord,
} from "@noobot/session-protocol/execution-lifecycle";
import {
  createTurnLifecycleSnapshot,
  createTurnTerminalResolution,
  requireTurnTerminalResolutionIdentity,
  isTurnSnapshotKnownSequence,
  isTurnSnapshotTerminalLimit,
} from "@noobot/session-protocol/turn-lifecycle";
import {
  assertTurnLifecycleStateIntegrity,
  assertTurnRecord,
  isTerminalTurnState,
  projectTurnTiming,
} from "@noobot/session-protocol";
import { normalizeTurnLifecycleEntity } from "../domain/turn-lifecycle-entity.js";
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
  const lifecycle = assertTurnLifecycleStateIntegrity(lifecycleSource);
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

export function resolveIndexedTurnTerminal({
  turn: lifecycleTurn,
  turnTimings,
  commandId,
  sessionId,
  turnScopeId,
  aggregateVersion = null,
  generatedAt,
}) {
  const identity = requireTurnTerminalResolutionIdentity({ commandId, sessionId, turnScopeId });
  if (lifecycleTurn !== null) {
    assertTurnRecord(lifecycleTurn);
    if (lifecycleTurn.turnScopeId !== turnScopeId)
      throw new TypeError("Terminal query turn ownership mismatch");
  }
  const retryAfterMs = TIME_THRESHOLDS.agent.terminalResolutionRetryDelayMs;
  const base = {
    ...identity,
    aggregateVersion,
    generatedAt,
  };
  const turn = lifecycleTurn
    ? { ...projectTurnTiming(lifecycleTurn, turnTimings), sessionId }
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

function executionOwnership(item) {
  return {
    executionKind: item.executionKind,
    sessionId: item.sessionId,
    parentSessionId: item.parentSessionId,
    turnScopeId: item.turnScopeId,
    parentExecutionId: item.parentExecutionId,
    rootExecutionId: item.rootExecutionId,
    origin: item.origin,
  };
}

function indexExecutionIdentity(execution, byId, conflicts) {
  const conflict = conflicts.get(execution.executionId);
  if (conflict) {
    conflict.identities.push(executionOwnership(execution));
    return;
  }
  const current = byId.get(execution.executionId);
  if (!current) {
    byId.set(execution.executionId, execution);
    return;
  }
  conflicts.set(execution.executionId, {
    executionId: execution.executionId,
    reason: EXECUTION_QUERY_IDENTITY_CONFLICT,
    identities: [current, execution].map(executionOwnership),
  });
  byId.delete(execution.executionId);
}

export function buildAuthoritativeExecutionReadModel(sources) {
  const byId = new Map();
  const conflicts = new Map();
  for (const source of sources) {
    const session = requireSessionExecutionSource(source);
    for (const turn of session.turns) {
      assertTurnRecord(turn);
      const execution = projectAuthoritativeExecution(turn, session);
      indexExecutionIdentity(execution, byId, conflicts);
    }
  }
  return { byId, conflicts };
}

function queryRelatedExecutions(readModel, includes) {
  for (const conflict of readModel.conflicts.values()) {
    if (
      conflict.identities.some((identity) =>
        includes({ ...identity, executionId: conflict.executionId }),
      )
    ) {
      return { found: false, reason: conflict.reason, conflict };
    }
  }
  return { found: true, executions: Array.from(readModel.byId.values()).filter(includes) };
}

export function queryAuthoritativeExecution(readModel, { executionId, generatedAt }) {
  if (!isExecutionQueryTargetValid(EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, { executionId }))
    return { found: false, reason: EXECUTION_QUERY_MISSING_TARGET };
  const conflict = readModel.conflicts.get(executionId);
  if (conflict) return { found: false, reason: conflict.reason, conflict };
  const execution = readModel.byId.get(executionId);
  return execution
    ? { found: true, execution, generatedAt }
    : { found: false, reason: "execution_not_found" };
}

export function queryAuthoritativeExecutionTree(
  readModel,
  { executionId = "", rootExecutionId, generatedAt },
) {
  if (
    !isExecutionQueryTargetValid(EXECUTION_QUERY_COMMAND.TREE_GET, { executionId, rootExecutionId })
  )
    return { found: false, reason: EXECUTION_QUERY_MISSING_TARGET };
  let rootId = rootExecutionId;
  if (executionId) {
    const focus = queryAuthoritativeExecution(readModel, {
      executionId,
      generatedAt,
    });
    if (!focus.found) return focus;
    if (!rootId) rootId = focus.execution.rootExecutionId;
  }
  const result = queryRelatedExecutions(readModel, (execution) =>
    isExecutionInRoot(execution, rootId),
  );
  if (!result.found) return result;
  const tree = buildExecutionTree(result.executions);
  const focusId = executionId || rootId;
  if (!Object.hasOwn(tree.executions, focusId))
    return { found: false, reason: "execution_not_found" };
  return {
    found: true,
    execution: tree.executions[focusId],
    rootExecutionId: rootId,
    tree,
    generatedAt,
  };
}

export function queryAuthoritativeExecutionChildren(readModel, options) {
  const focus = queryAuthoritativeExecution(readModel, options);
  if (!focus.found) return focus;
  const result = queryRelatedExecutions(readModel, (execution) =>
    isDirectExecutionChild(execution, focus.execution.executionId),
  );
  if (!result.found) return result;
  return { ...focus, children: result.executions };
}
