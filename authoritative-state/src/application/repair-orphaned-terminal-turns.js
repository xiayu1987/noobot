/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const clean = (value) => String(value || "").trim();

function resolveTurnScopeId(value = {}) {
  return clean(value?.turnScopeId || value?.additional_kwargs?.turnScopeId);
}

export function repairOrphanedTerminalTurns({ messages = [], turnLifecycle = {} } = {}) {
  const lifecycle = turnLifecycle && typeof turnLifecycle === "object" ? turnLifecycle : {};
  const turns = lifecycle.turns && typeof lifecycle.turns === "object" ? lifecycle.turns : {};
  const turnScopeIds = Object.keys(turns);
  if (!turnScopeIds.length) {
    return { repaired: false, turnLifecycle: lifecycle, orphanedTurnScopeIds: [] };
  }

  const scopesWithMessages = new Set(
    (Array.isArray(messages) ? messages : []).map(resolveTurnScopeId).filter(Boolean),
  );
  const orphanedTurnScopeIds = turnScopeIds.filter((turnScopeId) => {
    const turn = turns[turnScopeId] || {};
    if (!turn.terminalStatus) return false;
    return !scopesWithMessages.has(clean(turn.turnScopeId) || clean(turnScopeId));
  });
  if (!orphanedTurnScopeIds.length) {
    return { repaired: false, turnLifecycle: lifecycle, orphanedTurnScopeIds: [] };
  }

  const orphaned = new Set(orphanedTurnScopeIds);
  const repairedTurns = {};
  for (const [turnScopeId, turn] of Object.entries(turns)) {
    if (orphaned.has(turnScopeId)) continue;
    const survivor = { ...turn };
    if (orphaned.has(clean(survivor.continuedByTurnScopeId))) survivor.continuedByTurnScopeId = "";
    if (orphaned.has(clean(survivor.continuationSource?.turnScopeId)))
      survivor.continuationSource = null;
    repairedTurns[turnScopeId] = survivor;
  }

  return {
    repaired: true,
    orphanedTurnScopeIds,
    turnLifecycle: {
      ...lifecycle,
      activeTurnScopeId: orphaned.has(clean(lifecycle.activeTurnScopeId))
        ? ""
        : lifecycle.activeTurnScopeId,
      turns: repairedTurns,
    },
  };
}
