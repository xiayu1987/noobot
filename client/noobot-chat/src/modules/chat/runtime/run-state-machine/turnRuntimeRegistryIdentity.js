/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeTurnScopeId } from "../../model/messageIdentity.js";

export function runtimeText(value) {
  return String(value || "").trim();
}

export function canonicalTurnScopeId(value) {
  return canonicalizeTurnScopeId(value);
}

export function executionTurnKey(sessionId, turnScopeId) {
  const normalizedSessionId = runtimeText(sessionId);
  const normalizedTurnScopeId = canonicalTurnScopeId(turnScopeId);
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
}

export function sessionRuntimeId(value = {}) {
  return runtimeText(value?.sessionId || value);
}

export function createTurnRuntimeRegistryState() {
  return {
    sessions: {},
    routeIndex: {},
    executions: {},
    executionIdByTurnScopeId: {},
    childExecutionIdsByParentId: {},
    deletedTurnScopeIdsBySession: {},
  };
}

export function canonicalSessionId(sessionId) {
  return runtimeText(sessionId);
}

export function ensureSessionBucket(registry, sessionId) {
  const id = runtimeText(sessionId);
  if (!registry.sessions) registry.sessions = {};
  if (!registry.routeIndex) registry.routeIndex = {};
  if (!registry.sessions[id]) {
    registry.sessions[id] = {
      activeTurnScopeId: "",
      authoritativeSequence: 0,
      protocolVersion: 0,
      turns: {},
    };
  }
  return registry.sessions[id];
}

export function findTurnByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = canonicalTurnScopeId(turnScopeId);
  if (!scope) return null;
  const id = runtimeText(sessionId);
  if (id) return registry?.sessions?.[id]?.turns?.[scope] || null;
  for (const bucket of Object.values(registry?.sessions || {})) {
    const turn = bucket?.turns?.[scope];
    if (turn) return turn;
  }
  return null;
}

export function resolveTurnRoute(registry, dialogProcessId) {
  const id = runtimeText(dialogProcessId);
  return id ? registry?.routeIndex?.[id] || null : null;
}

export function isTurnRuntimeDeleted(registry, { sessionId = "", turnScopeId = "" } = {}) {
  const id = canonicalSessionId(sessionId);
  const scope = canonicalTurnScopeId(turnScopeId);
  return Boolean(id && scope && registry?.deletedTurnScopeIdsBySession?.[id]?.[scope]);
}

export function tombstoneTurnRuntime(registry, sessionId, turnScopeId) {
  const id = canonicalSessionId(sessionId);
  const scope = canonicalTurnScopeId(turnScopeId);
  if (!id || !scope) return false;
  if (!registry.deletedTurnScopeIdsBySession) registry.deletedTurnScopeIdsBySession = {};
  if (!registry.deletedTurnScopeIdsBySession[id]) registry.deletedTurnScopeIdsBySession[id] = {};
  const added = registry.deletedTurnScopeIdsBySession[id][scope] !== true;
  registry.deletedTurnScopeIdsBySession[id][scope] = true;
  return added;
}
