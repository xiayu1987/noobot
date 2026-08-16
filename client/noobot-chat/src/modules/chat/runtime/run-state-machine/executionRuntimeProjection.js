/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateExecutionIdentity } from "@noobot/session-protocol/execution-lifecycle";
import {
  canonicalTurnScopeId,
  executionTurnKey,
  isTurnRuntimeDeleted,
  runtimeText,
} from "./turnRuntimeRegistryIdentity.js";

export function runtimeFingerprint(value = {}) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

function removeExecutionProjection(registry, executionId) {
  const execution = registry?.executions?.[executionId];
  if (!execution) return false;
  const parentId = runtimeText(execution?.parentExecutionId);
  if (parentId && registry.childExecutionIdsByParentId?.[parentId]) {
    registry.childExecutionIdsByParentId[parentId] = registry.childExecutionIdsByParentId[
      parentId
    ].filter((id) => id !== executionId);
    if (!registry.childExecutionIdsByParentId[parentId].length) {
      delete registry.childExecutionIdsByParentId[parentId];
    }
  }
  const indexedTurnKey = executionTurnKey(execution?.sessionId, execution?.turnScopeId);
  if (indexedTurnKey && registry.executionIdByTurnScopeId?.[indexedTurnKey] === executionId) {
    delete registry.executionIdByTurnScopeId[indexedTurnKey];
  }
  delete registry.executions[executionId];
  delete registry.childExecutionIdsByParentId?.[executionId];
  return true;
}

export function applyExecutionProjection(registry, source = {}) {
  const validation = validateExecutionIdentity(source);
  if (!validation.valid) {
    return { applied: false, reason: "invalid_execution_identity", errors: validation.errors };
  }
  const current = registry.executions?.[validation.identity.executionId];
  const rawTurnScopeId = runtimeText(validation.identity?.turnScopeId || source?.turnScopeId);
  const canonicalScopeId = canonicalTurnScopeId(rawTurnScopeId);
  if (
    isTurnRuntimeDeleted(registry, {
      sessionId: validation.identity?.sessionId || source?.sessionId,
      turnScopeId: canonicalScopeId,
    })
  ) {
    return { applied: false, reason: "deleted_turn_tombstoned" };
  }
  const execution = {
    ...(current || {}),
    ...source,
    ...validation.identity,
    ...(canonicalScopeId ? { turnScopeId: canonicalScopeId } : {}),
    ...(rawTurnScopeId && rawTurnScopeId !== canonicalScopeId
      ? { protocolTurnScopeId: rawTurnScopeId }
      : {}),
  };
  if (
    current &&
    (Number(current.revision || 0) > Number(execution.revision || 0) ||
      (Number(current.revision || 0) === Number(execution.revision || 0) &&
        Number(current.sequence || 0) > Number(execution.sequence || 0)))
  ) {
    return { applied: false, reason: "stale_execution" };
  }
  if (
    current &&
    Number(current.revision || 0) === Number(execution.revision || 0) &&
    Number(current.sequence || 0) === Number(execution.sequence || 0)
  ) {
    const currentComparable = { ...current };
    const executionComparable = { ...execution };
    delete currentComparable._projectionFingerprint;
    delete executionComparable._projectionFingerprint;
    if (runtimeFingerprint(currentComparable) === runtimeFingerprint(executionComparable)) {
      return { applied: false, deduplicated: true, reason: "duplicate_execution" };
    }
    return { applied: false, reason: "execution_sequence_conflict" };
  }
  if (!registry.executions) registry.executions = {};
  if (!registry.executionIdByTurnScopeId) registry.executionIdByTurnScopeId = {};
  if (!registry.childExecutionIdsByParentId) registry.childExecutionIdsByParentId = {};
  const previousParentExecutionId = runtimeText(current?.parentExecutionId);
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

export function applyExecutionSnapshot(registry, payload = {}) {
  return applyExecutionProjection(registry, payload?.execution || payload);
}

export function applyExecutionChildren(registry, payload = {}) {
  const results = [
    payload?.execution,
    ...(Array.isArray(payload?.children) ? payload.children : []),
  ]
    .filter(Boolean)
    .map((item) => applyExecutionProjection(registry, item));
  return { applied: results.some((item) => item.applied), results };
}

export function applyExecutionTree(registry, payload = {}) {
  const rootExecutionId = runtimeText(payload?.rootExecutionId);
  const incoming = Object.values(payload?.tree?.executions || {});
  if (!rootExecutionId) {
    return { applied: false, reason: "invalid_execution_tree_root", results: [], rootExecutionId };
  }
  const validations = incoming.map((item) => validateExecutionIdentity(item));
  if (validations.some((item) => !item.valid)) {
    return {
      applied: false,
      reason: "invalid_execution_tree",
      errors: validations.flatMap((item) => item.errors || []),
      results: [],
      rootExecutionId,
    };
  }
  if (
    validations.some(
      ({ identity }) =>
        identity.executionId !== rootExecutionId && identity.rootExecutionId !== rootExecutionId,
    )
  ) {
    return { applied: false, reason: "execution_tree_root_conflict", results: [], rootExecutionId };
  }
  const tombstones = Array.isArray(payload?.removedExecutions) ? payload.removedExecutions : [];
  const removedExecutionIds = [];
  const acceptedTombstones = new Map();
  for (const tombstone of tombstones) {
    const executionId = runtimeText(tombstone?.executionId);
    const current = registry?.executions?.[executionId];
    const revision = Number(tombstone?.revision);
    const sequence = Number(tombstone?.sequence);
    if (
      !executionId ||
      !current ||
      runtimeText(current?.rootExecutionId || current?.executionId) !== rootExecutionId
    ) {
      continue;
    }
    if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(sequence) || sequence < 1) {
      continue;
    }
    if (
      Number(current.revision || 0) > revision ||
      (Number(current.revision || 0) === revision && Number(current.sequence || 0) >= sequence)
    ) {
      continue;
    }
    if (removeExecutionProjection(registry, executionId)) {
      removedExecutionIds.push(executionId);
      acceptedTombstones.set(executionId, { revision, sequence });
    }
  }
  const results = incoming
    .filter((item = {}) => {
      const tombstone = acceptedTombstones.get(runtimeText(item.executionId));
      if (!tombstone) return true;
      const revision = Number(item.revision || 0);
      const sequence = Number(item.sequence || 0);
      return (
        revision > tombstone.revision ||
        (revision === tombstone.revision && sequence > tombstone.sequence)
      );
    })
    .map((item) => applyExecutionProjection(registry, item));
  return {
    applied: removedExecutionIds.length > 0 || results.some((item) => item.applied),
    results,
    removedExecutionIds,
    rootExecutionId,
  };
}

export function selectExecution(registry, executionId) {
  return registry?.executions?.[runtimeText(executionId)] || null;
}

export function selectExecutionChildren(registry, executionId) {
  return (registry?.childExecutionIdsByParentId?.[runtimeText(executionId)] || [])
    .map((id) => registry?.executions?.[id])
    .filter(Boolean);
}
