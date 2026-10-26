/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireOptionalCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { text } from "@noobot/shared/value";

export function executionTurnKey(sessionId, turnScopeId) {
  const normalizedSessionId = text(sessionId);
  const normalizedTurnScopeId = requireOptionalCanonicalTurnScopeId(turnScopeId);
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
}

export function sessionRuntimeId(session) {
  return text(session.sessionId);
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

export function ensureSessionBucket(registry, sessionId) {
  const id = text(sessionId);
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

export function findTurnByScope(registry, turnScopeId, { sessionId }) {
  const scope = requireOptionalCanonicalTurnScopeId(turnScopeId);
  if (!scope) return null;
  const id = text(sessionId);
  if (id) return registry.sessions[id]?.turns[scope] || null;
  for (const bucket of Object.values(registry.sessions)) {
    const turn = bucket.turns[scope];
    if (turn) return turn;
  }
  return null;
}

export function resolveTurnRoute(registry, dialogProcessId) {
  const id = text(dialogProcessId);
  return id ? registry.routeIndex[id] || null : null;
}

export function isTurnRuntimeDeleted(registry, { sessionId, turnScopeId }) {
  const id = text(sessionId);
  const scope = requireOptionalCanonicalTurnScopeId(turnScopeId);
  return Boolean(id && scope && registry.deletedTurnScopeIdsBySession[id]?.[scope]);
}

export function tombstoneTurnRuntime(registry, sessionId, turnScopeId) {
  const id = text(sessionId);
  const scope = requireOptionalCanonicalTurnScopeId(turnScopeId);
  if (!id || !scope) return false;
  if (!registry.deletedTurnScopeIdsBySession[id]) registry.deletedTurnScopeIdsBySession[id] = {};
  const added = registry.deletedTurnScopeIdsBySession[id][scope] !== true;
  registry.deletedTurnScopeIdsBySession[id][scope] = true;
  return added;
}
