/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeTurnTerminalStatus } from "@noobot/session-protocol";
import { text as clean } from "@noobot/shared/value";

function resolveTurnScopeId(value = {}) {
  return clean(value?.turnScopeId || value?.additional_kwargs?.turnScopeId);
}

export function repairOrphanedTerminalTurns({ messages, turnLifecycle }) {
  const lifecycle = turnLifecycle;
  const { turns } = lifecycle;
  const turnScopeIds = Object.keys(turns);
  if (!turnScopeIds.length) {
    return { repaired: false, turnLifecycle: lifecycle, orphanedTurnScopeIds: [] };
  }

  const scopesWithMessages = new Set(messages.map(resolveTurnScopeId).filter(Boolean));
  const orphanedTurnScopeIds = turnScopeIds.filter((turnScopeId) => {
    const turn = turns[turnScopeId];
    if (!normalizeTurnTerminalStatus(turn.terminalStatus)) return false;
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
