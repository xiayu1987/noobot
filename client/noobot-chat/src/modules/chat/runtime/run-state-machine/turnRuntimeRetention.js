/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  canonicalSessionId,
  canonicalTurnScopeId,
  runtimeText,
  tombstoneTurnRuntime,
} from "./turnRuntimeRegistryIdentity.js";
import {
  resolveLatestContinuableStoppedTurn,
  resolveSessionTurnRuntime,
  resolveTurnRuntimeByScope,
} from "./turnRuntimeSelectors.js";

export const DEFAULT_TERMINAL_RETAIN_PER_SESSION = 10;
export const DEFAULT_TERMINAL_MAX_AGE_MS = TIME_THRESHOLDS.client.terminalTurnRetentionMs;

export function removeTurnRuntime(registry, turnScopeId, { sessionId = "" } = {}) {
  if (!registry) return false;
  const scope = canonicalTurnScopeId(turnScopeId);
  const expectedSessionId = canonicalSessionId(sessionId);
  const turn = resolveTurnRuntimeByScope(registry, scope, { sessionId: expectedSessionId });
  if (!turn || (expectedSessionId && turn.sessionId !== expectedSessionId)) return false;
  const bucket = registry?.sessions?.[turn.sessionId];
  if (!bucket) return false;
  delete bucket.turns[scope];
  if (turn.dialogProcessId && registry.routeIndex?.[turn.dialogProcessId]?.turnScopeId === scope) {
    delete registry.routeIndex[turn.dialogProcessId];
  }
  if (bucket.activeTurnScopeId === scope) bucket.activeTurnScopeId = "";
  if (!Object.keys(bucket.turns).length) delete registry.sessions[turn.sessionId];
  return true;
}

export function confirmTurnRuntimeDeletion(registry, turnScopeIds = [], { sessionId = "" } = {}) {
  if (!registry) return { applied: false, confirmedTurnScopeIds: [], removedTurnScopeIds: [] };
  const id = canonicalSessionId(sessionId);
  const scopes = [
    ...new Set(
      (Array.isArray(turnScopeIds) ? turnScopeIds : [turnScopeIds])
        .map(canonicalTurnScopeId)
        .filter(Boolean),
    ),
  ];
  const confirmedTurnScopeIds = [];
  const removedTurnScopeIds = [];
  for (const scope of scopes) {
    if (tombstoneTurnRuntime(registry, id, scope)) confirmedTurnScopeIds.push(scope);
    if (removeTurnRuntime(registry, scope, { sessionId: id })) removedTurnScopeIds.push(scope);
  }
  return {
    applied: confirmedTurnScopeIds.length > 0 || removedTurnScopeIds.length > 0,
    confirmedTurnScopeIds,
    removedTurnScopeIds,
  };
}

export function removeSessionRuntime(registry, sessionId) {
  const id = canonicalSessionId(sessionId);
  const bucket = registry?.sessions?.[id];
  const hadTombstones = Boolean(registry?.deletedTurnScopeIdsBySession?.[id]);
  if (!bucket && !hadTombstones) return false;
  for (const turn of Object.values(bucket?.turns || {})) {
    const route = registry.routeIndex?.[runtimeText(turn?.dialogProcessId)];
    if (route?.sessionId === id && route?.turnScopeId === turn.turnScopeId) {
      delete registry.routeIndex[turn.dialogProcessId];
    }
  }
  delete registry.sessions[id];
  delete registry.deletedTurnScopeIdsBySession?.[id];
  return true;
}

export function pruneTerminalTurns(
  registry,
  {
    sessionId,
    referencedTurnScopeIds = [],
    retainCount = DEFAULT_TERMINAL_RETAIN_PER_SESSION,
    maxAgeMs = DEFAULT_TERMINAL_MAX_AGE_MS,
    nowMs = Date.now(),
  } = {},
) {
  const id = runtimeText(sessionId);
  const bucket = registry?.sessions?.[id];
  if (!bucket) return { removedTurnScopeIds: [] };
  const referenced = new Set(
    Array.from(referencedTurnScopeIds || [], canonicalTurnScopeId).filter(Boolean),
  );
  const selectedScope = runtimeText(resolveSessionTurnRuntime(registry, id)?.turnScopeId);
  const latestStoppedScope = runtimeText(
    resolveLatestContinuableStoppedTurn(registry, id)?.turnScopeId,
  );
  const terminalTurns = Object.values(bucket.turns || {})
    .filter((turn) => Boolean(turn.terminal))
    .sort(
      (left, right) =>
        Number(right.finishedAtMs || right.updatedAtMs || 0) -
        Number(left.finishedAtMs || left.updatedAtMs || 0),
    );
  const removedTurnScopeIds = [];
  let retainedUnprotectedCount = 0;
  for (const turn of terminalTurns) {
    const scope = runtimeText(turn.turnScopeId);
    if (scope === selectedScope || scope === latestStoppedScope || referenced.has(scope)) continue;
    const finishedAtMs = Number(turn.finishedAtMs || turn.updatedAtMs || 0);
    const tooOld = maxAgeMs >= 0 && finishedAtMs > 0 && Number(nowMs) - finishedAtMs > maxAgeMs;
    const overCount = retainCount >= 0 && retainedUnprotectedCount >= retainCount;
    if (tooOld || overCount) {
      if (removeTurnRuntime(registry, scope, { sessionId: id })) removedTurnScopeIds.push(scope);
    } else {
      retainedUnprotectedCount += 1;
    }
  }
  return { removedTurnScopeIds };
}
