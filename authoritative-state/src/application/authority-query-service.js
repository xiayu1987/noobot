/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildExecutionTree,
  normalizeExecutionIdentity,
} from "@noobot/shared/execution-lifecycle-protocol";
import {
  createTurnLifecycleSnapshot,
  createTurnTerminalResolution,
  deriveAuthoritativeTurnCapabilities,
} from "@noobot/event-protocol/turn-lifecycle";
import {
  isTerminalTurnLifecycleState,
  normalizeTurnLifecycleEntity,
  projectTurnLifecycleTiming,
} from "../domain/turn-lifecycle-entity.js";

const clean = (value) => String(value || "").trim();

export function createAuthoritativeTurnSnapshot({
  lifecycle: lifecycleSource = {}, turnTimings = [], commandId = "", userId = "",
  sessionId = "", knownSequence, terminalLimit = 10, terminalTurnScopeIds = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const lifecycle = normalizeTurnLifecycleEntity(lifecycleSource);
  const terminalTurnScopes = new Set(
    (Array.isArray(terminalTurnScopeIds) ? terminalTurnScopeIds : []).map(clean).filter(Boolean),
  );
  const activeTurn = lifecycle.turns[lifecycle.activeTurnScopeId]
    ? { ...projectTurnLifecycleTiming(lifecycle.turns[lifecycle.activeTurnScopeId], turnTimings), sessionId: clean(sessionId) }
    : null;
  const limit = Math.max(0, Math.min(100, Number(terminalLimit) || 10));
  const recentTerminalTurns = Object.values(lifecycle.turns)
    .filter((turn) => (
      terminalTurnScopes.has(turn.turnScopeId) && isTerminalTurnLifecycleState(turn.state)
    ))
    .sort((left, right) => Number(right.sequence) - Number(left.sequence))
    .slice(0, limit)
    .map((turn) => ({ ...projectTurnLifecycleTiming(turn, turnTimings), sessionId: clean(sessionId) }));
  return createTurnLifecycleSnapshot({
    commandId,
    userId,
    sessionId,
    sequence: lifecycle.sequence,
    activeTurnScopeId: lifecycle.activeTurnScopeId,
    activeTurn,
    recentTerminalTurns,
    replacedTurns: Object.values(lifecycle.replacedTurns),
    unchanged: knownSequence !== undefined && Number(knownSequence) === lifecycle.sequence,
    generatedAt,
  });
}

export function resolveAuthoritativeTurnTerminal({
  lifecycle: lifecycleSource = {}, turnTimings = [], commandId = "", sessionId = "",
  turnScopeId = "", retryAfterMs = 250,
} = {}) {
  const normalizedCommandId = clean(commandId);
  const normalizedSessionId = clean(sessionId);
  const normalizedTurnScopeId = clean(turnScopeId);
  const base = {
    commandId: normalizedCommandId || "invalid",
    sessionId: normalizedSessionId,
    turnScopeId: normalizedTurnScopeId,
  };
  if (!normalizedCommandId || !normalizedSessionId || !normalizedTurnScopeId) {
    return createTurnTerminalResolution({ ...base, reason: "invalid_terminal_resolution_request" });
  }
  const lifecycle = normalizeTurnLifecycleEntity(lifecycleSource);
  const lifecycleTurn = lifecycle.turns[normalizedTurnScopeId] || null;
  const turn = lifecycleTurn
    ? { ...projectTurnLifecycleTiming(lifecycleTurn, turnTimings), sessionId: normalizedSessionId }
    : null;
  if (!turn) {
    return createTurnTerminalResolution({
      ...base, reason: "turn_not_found", retryable: true, retryAfterMs,
    });
  }
  if (!isTerminalTurnLifecycleState(turn.state)) {
    return createTurnTerminalResolution({
      ...base, reason: "turn_not_terminal", retryable: true, retryAfterMs, turn,
    });
  }
  if (!turn.terminalStatus) {
    return createTurnTerminalResolution({
      ...base, reason: "terminal_status_not_ready", retryable: true, retryAfterMs, turn,
    });
  }
  return createTurnTerminalResolution({ ...base, resolved: true, turn });
}

export function projectAuthoritativeExecution(turn = {}, session = {}) {
  const timedTurn = {
    ...projectTurnLifecycleTiming(turn, session.turnTimings),
    sessionId: clean(session.sessionId),
  };
  const identity = normalizeExecutionIdentity({
    ...timedTurn,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
  });
  return {
    ...identity,
    commandId: clean(timedTurn.commandId),
    action: clean(timedTurn.action),
    state: clean(timedTurn.state),
    phase: clean(timedTurn.phase),
    executionState: clean(timedTurn.executionState).toLowerCase(),
    revision: Number(timedTurn.revision || 0),
    sequence: Number(timedTurn.sequence || 0),
    summaryVersion: Number(timedTurn.summaryVersion || 0),
    capabilities: deriveAuthoritativeTurnCapabilities(timedTurn),
    failure: timedTurn.failure && typeof timedTurn.failure === "object" ? { ...timedTurn.failure } : null,
    continuationSource: timedTurn.continuationSource || null,
    continuedByTurnScopeId: clean(timedTurn.continuedByTurnScopeId),
    startedAt: clean(timedTurn.startedAt),
    finishedAt: clean(timedTurn.finishedAt),
    createdAt: clean(timedTurn.createdAt),
    updatedAt: clean(timedTurn.updatedAt),
  };
}

function isNewer(left, right) {
  const leftUpdatedAt = Date.parse(left?.updatedAt || "") || 0;
  const rightUpdatedAt = Date.parse(right?.updatedAt || "") || 0;
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt > rightUpdatedAt;
  if (Number(left?.revision || 0) !== Number(right?.revision || 0)) {
    return Number(left?.revision || 0) > Number(right?.revision || 0);
  }
  return Number(left?.sequence || 0) > Number(right?.sequence || 0);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function ownershipFingerprint(execution = {}) {
  return JSON.stringify(stableObject({
    executionKind: clean(execution.executionKind).toLowerCase(),
    sessionId: clean(execution.sessionId),
    parentSessionId: clean(execution.parentSessionId),
    turnScopeId: clean(execution.turnScopeId),
    parentExecutionId: clean(execution.parentExecutionId),
    rootExecutionId: clean(execution.rootExecutionId),
    origin: execution.origin && typeof execution.origin === "object" ? execution.origin : {},
  }));
}

export function buildAuthoritativeExecutionReadModel(sessions = []) {
  const byId = new Map();
  const conflicts = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const lifecycle = normalizeTurnLifecycleEntity(session?.turnLifecycle || {});
    for (const turn of Object.values(lifecycle.turns)) {
      const execution = projectAuthoritativeExecution(turn, session);
      if (!execution.executionId) continue;
      const current = byId.get(execution.executionId);
      if (!current) {
        byId.set(execution.executionId, execution);
        continue;
      }
      if (ownershipFingerprint(current) !== ownershipFingerprint(execution)) {
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
        continue;
      }
      if (!conflicts.has(execution.executionId) && isNewer(execution, current)) byId.set(execution.executionId, execution);
    }
  }
  return { executions: [...byId.values()], conflicts };
}

export function queryAuthoritativeExecution(readModel, { executionId, generatedAt = new Date().toISOString() } = {}) {
  const id = clean(executionId);
  if (!id) return { found: false, reason: "missing_execution" };
  const conflict = readModel.conflicts.get(id);
  if (conflict) return { found: false, reason: conflict.reason, conflict };
  const execution = readModel.executions.find((item) => item.executionId === id);
  return execution ? { found: true, execution, generatedAt } : { found: false, reason: "execution_not_found" };
}

export function queryAuthoritativeExecutionTree(readModel, {
  executionId = "", rootExecutionId = "", generatedAt = new Date().toISOString(),
} = {}) {
  const requestedExecutionId = clean(executionId);
  const requestedRootId = clean(rootExecutionId);
  const conflict = readModel.conflicts.get(requestedExecutionId || requestedRootId);
  if (conflict) return { found: false, reason: conflict.reason, conflict };
  const selected = requestedExecutionId
    ? readModel.executions.find((item) => item.executionId === requestedExecutionId)
    : readModel.executions.find((item) => item.executionId === requestedRootId || item.rootExecutionId === requestedRootId);
  if ((requestedExecutionId || requestedRootId) && !selected) return { found: false, reason: "execution_not_found" };
  const rootId = requestedRootId || selected?.rootExecutionId || selected?.executionId || "";
  const scoped = rootId
    ? readModel.executions.filter((item) => item.executionId === rootId || item.rootExecutionId === rootId)
    : readModel.executions;
  const tree = buildExecutionTree(scoped);
  return {
    found: true,
    execution: requestedExecutionId ? tree.executions[requestedExecutionId] || null : tree.executions[rootId] || null,
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
