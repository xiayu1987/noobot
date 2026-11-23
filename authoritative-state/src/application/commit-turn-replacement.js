/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnReplacementCommit,
  collectTurnReplacementTombstoneErrors,
  projectTurnReplacementTombstone,
} from "@noobot/session-protocol";
import { normalizeTurnLifecycleEntity } from "../domain/turn-lifecycle-entity.js";
import { text as clean, isFunction } from "@noobot/shared/value";
import {
  readIndexedTurnRemoval,
  projectIndexedLifecycleResult,
} from "../domain/indexed-turn-lifecycle.js";

function sameReplacement(left = {}, right = {}) {
  const leftScopes = [
    ...new Set((left.replacedTurnScopeIds || []).map(clean).filter(Boolean)),
  ].sort();
  const rightScopes = [
    ...new Set((right.replacedTurnScopeIds || []).map(clean).filter(Boolean)),
  ].sort();
  return (
    clean(left.commandId) === clean(right.commandId) &&
    clean(left.replacementDialogProcessId) === clean(right.replacementDialogProcessId) &&
    clean(left.replacementTurnScopeId) === clean(right.replacementTurnScopeId) &&
    clean(left.replacementUserMessageUid) === clean(right.replacementUserMessageUid) &&
    clean(left.requestHash) === clean(right.requestHash) &&
    Number(left.committedAggregateVersion || 0) === Number(right.committedAggregateVersion || 0) &&
    clean(left.committedAt) === clean(right.committedAt) &&
    JSON.stringify(leftScopes) === JSON.stringify(rightScopes)
  );
}

export function commitTurnReplacement({ lifecycle, replacement = {} } = {}) {
  const normalizedLifecycle = normalizeTurnLifecycleEntity(lifecycle);
  return commitPreparedTurnReplacement({
    lifecycle: normalizedLifecycle,
    replacement,
    commandReplacements: Object.values(normalizedLifecycle.replacedTurns).filter(
      (item) => clean(item.commandId) === clean(replacement?.commandId),
    ),
  });
}

function commitPreparedTurnReplacement({
  lifecycle: normalizedLifecycle,
  replacement,
  commandReplacements,
}) {
  try {
    assertTurnReplacementCommit(replacement);
  } catch (error) {
    return {
      applied: false,
      reason: "invalid_turn_replacement",
      error: String(error?.message || error || ""),
      lifecycle: normalizedLifecycle,
    };
  }

  const replacedTurnScopeIds = replacement.replacedTurnScopeIds.map(clean);
  if (commandReplacements.some((item) => !sameReplacement(item, replacement))) {
    return {
      applied: false,
      reason: "turn_replacement_conflict",
      lifecycle: normalizedLifecycle,
    };
  }
  for (const turnScopeId of replacedTurnScopeIds) {
    const existing = normalizedLifecycle.replacedTurns[turnScopeId];
    if (existing && !sameReplacement(existing, replacement)) {
      return {
        applied: false,
        reason: "turn_replacement_conflict",
        lifecycle: normalizedLifecycle,
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
    };
  }

  const replacedScopes = new Set(replacedTurnScopeIds);
  const survivingContinuationWithReplacedSource = Object.values(normalizedLifecycle.turns).find(
    (turn) =>
      !replacedScopes.has(clean(turn.turnScopeId)) &&
      replacedScopes.has(clean(turn.continuationSource?.turnScopeId)),
  );
  if (survivingContinuationWithReplacedSource) {
    return {
      applied: false,
      reason: "turn_replacement_breaks_continuation_source",
      lifecycle: normalizedLifecycle,
    };
  }
  const sequence = normalizedLifecycle.sequence + 1;
  for (const turnScopeId of replacedTurnScopeIds) {
    delete normalizedLifecycle.turns[turnScopeId];
    normalizedLifecycle.replacedTurns[turnScopeId] = projectTurnReplacementTombstone(replacement, {
      turnScopeId,
      sequence,
    });
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
  return {
    applied: true,
    lifecycle: normalizedLifecycle,
    replacement,
    removedTurnScopeIds: replacedTurnScopeIds,
  };
}

export async function commitIndexedTurnReplacement(options) {
  const { replacement, readReplacement, readCommandReplacement } = options;
  if (!isFunction(readReplacement) || !isFunction(readCommandReplacement))
    throw new TypeError("Indexed replacement requires replacement and command readers");
  try {
    assertTurnReplacementCommit(replacement);
  } catch (error) {
    return {
      applied: false,
      reason: "invalid_turn_replacement",
      error: String(error.message),
      changedTurns: [],
    };
  }
  const { lifecycle } = await readIndexedTurnRemoval({
    ...options,
    turnScopeIds: replacement.replacedTurnScopeIds,
  });
  for (const key of replacement.replacedTurnScopeIds) {
    const tombstone = await readReplacement(key);
    if (tombstone === null) continue;
    if (
      tombstone.turnScopeId !== key ||
      collectTurnReplacementTombstoneErrors(tombstone, lifecycle.sequence).length
    )
      throw Object.assign(new TypeError("Invalid indexed replacement tombstone"), {
        code: "TURN_LIFECYCLE_RECORD_INVALID",
      });
    Object.defineProperty(lifecycle.replacedTurns, key, {
      value: structuredClone(tombstone),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const previous = await readCommandReplacement(replacement.commandId);
  if (previous !== null) {
    assertTurnReplacementCommit(previous);
    if (previous.commandId !== replacement.commandId)
      throw Object.assign(new TypeError("Indexed replacement command identity mismatch"), {
        code: "TURN_LIFECYCLE_RECORD_INVALID",
      });
  }
  const transition = commitPreparedTurnReplacement({
    lifecycle: structuredClone(lifecycle),
    replacement,
    commandReplacements: previous === null ? [] : [previous],
  });
  return {
    ...projectIndexedLifecycleResult(lifecycle, transition),
    changedReplacements: transition.applied
      ? replacement.replacedTurnScopeIds.map((key) => transition.lifecycle.replacedTurns[key])
      : [],
  };
}
