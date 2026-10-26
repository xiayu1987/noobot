/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  compareExecutionVersion,
  projectExecutionRecord,
  validateExecutionRecord,
} from "@noobot/session-protocol/execution-lifecycle";
import { executionTurnKey, isTurnRuntimeDeleted } from "./turnRuntimeRegistryIdentity.js";
import { isObjectLike, text } from "@noobot/shared/value";

export function runtimeFingerprint(value = {}) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!isObjectLike(input)) return input;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function applyExecutionProjection(registry, source) {
  const validation = validateExecutionRecord(source);
  if (!validation.valid) {
    return { applied: false, reason: "invalid_execution_record", errors: validation.errors };
  }
  const execution = projectExecutionRecord(source);
  if (isTurnRuntimeDeleted(registry, execution)) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  const current = registry.executions[execution.executionId];
  const order = current ? compareExecutionVersion(execution, current) : 1;
  if (order < 0) return { applied: false, reason: "stale_execution" };
  if (order === 0) {
    return runtimeFingerprint(current) === runtimeFingerprint(execution)
      ? { applied: false, deduplicated: true, reason: "duplicate_execution" }
      : { applied: false, reason: "execution_sequence_conflict" };
  }
  const previousParentExecutionId = text(current?.parentExecutionId);
  if (previousParentExecutionId && previousParentExecutionId !== execution.parentExecutionId) {
    registry.childExecutionIdsByParentId[previousParentExecutionId] = (
      registry.childExecutionIdsByParentId[previousParentExecutionId] || []
    ).filter((id) => id !== execution.executionId);
    if (!registry.childExecutionIdsByParentId[previousParentExecutionId].length) {
      delete registry.childExecutionIdsByParentId[previousParentExecutionId];
    }
  }
  registry.executions[execution.executionId] = execution;
  const indexedTurnKey = executionTurnKey(execution.sessionId, execution.turnScopeId);
  if (indexedTurnKey) registry.executionIdByTurnScopeId[indexedTurnKey] = execution.executionId;
  if (execution.parentExecutionId) {
    const children = new Set(
      registry.childExecutionIdsByParentId[execution.parentExecutionId] || [],
    );
    children.add(execution.executionId);
    registry.childExecutionIdsByParentId[execution.parentExecutionId] = [...children];
  }
  return { applied: true, execution };
}

export function applyExecutionSnapshot(registry, payload) {
  return applyExecutionProjection(registry, payload.execution);
}

export function applyExecutionChildren(registry, payload) {
  const results = [payload.execution, ...payload.children].map((item) =>
    applyExecutionProjection(registry, item),
  );
  return { applied: results.some((item) => item.applied), results };
}

export function applyExecutionTree(registry, payload) {
  const results = Object.values(payload.tree.executions).map((item) =>
    applyExecutionProjection(registry, item),
  );
  return {
    applied: results.some((item) => item.applied),
    results,
    rootExecutionId: payload.rootExecutionId,
  };
}

export function selectExecution(registry, executionId) {
  return registry.executions[text(executionId)] || null;
}

export function selectTurnExecution(registry, sessionId, turnScopeId) {
  const executionId = registry.executionIdByTurnScopeId[executionTurnKey(sessionId, turnScopeId)];
  return executionId ? selectExecution(registry, executionId) : null;
}

export function selectExecutionChildren(registry, executionId) {
  return (registry.childExecutionIdsByParentId[text(executionId)] || [])
    .map((id) => registry.executions[id])
    .filter(Boolean);
}
