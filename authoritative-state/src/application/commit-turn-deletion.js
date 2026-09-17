/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTurnLifecycleEntity } from "../domain/turn-lifecycle-entity.js";

const clean = (value) => String(value || "").trim();

export function commitTurnDeletion({ lifecycle = {}, turnScopeIds = [] } = {}) {
  const normalizedLifecycle = normalizeTurnLifecycleEntity(lifecycle);
  const deletedTurnScopeIds = [
    ...new Set((Array.isArray(turnScopeIds) ? turnScopeIds : []).map(clean).filter(Boolean)),
  ];
  if (!deletedTurnScopeIds.length) {
    return {
      applied: false,
      reason: "empty_turn_deletion",
      lifecycle: normalizedLifecycle,
      removedTurnScopeIds: [],
    };
  }

  const deletedScopes = new Set(deletedTurnScopeIds);
  for (const turnScopeId of deletedTurnScopeIds) {
    delete normalizedLifecycle.turns[turnScopeId];
  }
  if (deletedScopes.has(normalizedLifecycle.activeTurnScopeId)) {
    normalizedLifecycle.activeTurnScopeId = "";
  }
  const clearedContinuationSourceTurnScopeIds = [];
  for (const turn of Object.values(normalizedLifecycle.turns)) {
    if (deletedScopes.has(clean(turn.continuedByTurnScopeId))) {
      turn.continuedByTurnScopeId = "";
    }
    if (deletedScopes.has(clean(turn.continuationSource?.turnScopeId))) {
      turn.continuationSource = null;
      clearedContinuationSourceTurnScopeIds.push(clean(turn.turnScopeId));
    }
  }
  normalizedLifecycle.commandReceipts = normalizedLifecycle.commandReceipts.filter(
    (receipt) => !deletedScopes.has(clean(receipt.turnScopeId)),
  );
  normalizedLifecycle.sequence += 1;
  return {
    applied: true,
    lifecycle: normalizedLifecycle,
    removedTurnScopeIds: deletedTurnScopeIds,
    clearedContinuationSourceTurnScopeIds,
  };
}
