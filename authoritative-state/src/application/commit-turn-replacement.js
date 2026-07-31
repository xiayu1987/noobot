/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnReplacementCommit } from "@noobot/shared/turn-replacement-protocol";
import { normalizeAuthorityEventOutbox } from "../contracts/authority-event-outbox.mjs";
import { normalizeTurnLifecycleEntity } from "../domain/turn-lifecycle-entity.js";

const clean = (value) => String(value || "").trim();

function sameReplacement(left = {}, right = {}) {
  const leftScopes = [...new Set((left.replacedTurnScopeIds || []).map(clean).filter(Boolean))].sort();
  const rightScopes = [...new Set((right.replacedTurnScopeIds || []).map(clean).filter(Boolean))].sort();
  return clean(left.commandId) === clean(right.commandId) &&
    clean(left.replacementTurnScopeId) === clean(right.replacementTurnScopeId) &&
    clean(left.replacementUserMessageId) === clean(right.replacementUserMessageId) &&
    Number(left.committedVersion || 0) === Number(right.committedVersion || 0) &&
    clean(left.committedAt) === clean(right.committedAt) &&
    JSON.stringify(leftScopes) === JSON.stringify(rightScopes);
}

/**
 * Commits a message Turn replacement into lifecycle authority. The storage
 * owner must persist the returned lifecycle and outbox with the message
 * replacement in one session transaction.
 */
export function commitTurnReplacement({ lifecycle = {}, eventOutbox = [], replacement = {} } = {}) {
  try {
    assertTurnReplacementCommit(replacement);
  } catch (error) {
    return {
      applied: false,
      reason: "invalid_turn_replacement",
      error: String(error?.message || error || ""),
      lifecycle: normalizeTurnLifecycleEntity(lifecycle),
      eventOutbox: normalizeAuthorityEventOutbox(eventOutbox),
    };
  }

  const normalizedLifecycle = normalizeTurnLifecycleEntity(lifecycle);
  const normalizedOutbox = normalizeAuthorityEventOutbox(eventOutbox);
  const replacedTurnScopeIds = replacement.replacedTurnScopeIds.map(clean);
  const existingCommandTombstones = Object.values(normalizedLifecycle.replacedTurns).filter(
    (item) => clean(item.commandId) === clean(replacement.commandId),
  );
  if (existingCommandTombstones.some((item) => !sameReplacement(item, replacement))) {
    return {
      applied: false,
      reason: "turn_replacement_conflict",
      lifecycle: normalizedLifecycle,
      eventOutbox: normalizedOutbox,
    };
  }
  for (const turnScopeId of replacedTurnScopeIds) {
    const existing = normalizedLifecycle.replacedTurns[turnScopeId];
    if (existing && !sameReplacement(existing, replacement)) {
      return {
        applied: false,
        reason: "turn_replacement_conflict",
        lifecycle: normalizedLifecycle,
        eventOutbox: normalizedOutbox,
      };
    }
  }

  const deduplicated = replacedTurnScopeIds.every((turnScopeId) =>
    sameReplacement(normalizedLifecycle.replacedTurns[turnScopeId], replacement),
  );
  if (deduplicated) {
    return {
      applied: false,
      deduplicated: true,
      reason: "duplicate_turn_replacement",
      lifecycle: normalizedLifecycle,
      eventOutbox: normalizedOutbox,
    };
  }

  const replacedScopes = new Set(replacedTurnScopeIds);
  const survivingContinuationWithReplacedSource = Object.values(normalizedLifecycle.turns).find(
    (turn) => !replacedScopes.has(clean(turn.turnScopeId)) &&
      replacedScopes.has(clean(turn.continuationSource?.turnScopeId)),
  );
  if (survivingContinuationWithReplacedSource) {
    return {
      applied: false,
      reason: "turn_replacement_breaks_continuation_source",
      lifecycle: normalizedLifecycle,
      eventOutbox: normalizedOutbox,
    };
  }
  const sequence = normalizedLifecycle.sequence + 1;
  for (const turnScopeId of replacedTurnScopeIds) {
    delete normalizedLifecycle.turns[turnScopeId];
    normalizedLifecycle.replacedTurns[turnScopeId] = {
      turnScopeId,
      replacementTurnScopeId: clean(replacement.replacementTurnScopeId),
      replacementUserMessageId: clean(replacement.replacementUserMessageId),
      commandId: clean(replacement.commandId),
      committedVersion: Number(replacement.committedVersion),
      replacedTurnScopeIds: [...replacedTurnScopeIds],
      sequence,
      committedAt: clean(replacement.committedAt),
    };
  }
  if (replacedScopes.has(normalizedLifecycle.activeTurnScopeId)) {
    normalizedLifecycle.activeTurnScopeId = "";
  }
  for (const turn of Object.values(normalizedLifecycle.turns)) {
    if (replacedScopes.has(clean(turn.continuedByTurnScopeId))) {
      turn.continuedByTurnScopeId = "";
    }
  }
  normalizedLifecycle.sequence = sequence;
  normalizedLifecycle.commandReceipts = normalizedLifecycle.commandReceipts.filter(
    (receipt) => !replacedScopes.has(clean(receipt.turnScopeId)),
  );
  const nextOutbox = normalizedOutbox.filter(
    (item) => !replacedScopes.has(clean(item?.envelope?.turnScopeId)),
  );
  return {
    applied: true,
    lifecycle: normalizedLifecycle,
    eventOutbox: nextOutbox,
    replacement,
    removedTurnScopeIds: replacedTurnScopeIds,
  };
}
