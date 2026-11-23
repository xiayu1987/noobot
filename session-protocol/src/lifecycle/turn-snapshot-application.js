/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stableValue } from "@noobot/shared/value";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { validateTurnLifecycleSnapshot } from "../turn-lifecycle.js";
import { snapshotTurn, snapshotReplacedTurn } from "./turn-projection.js";

const canonical = (value) => JSON.stringify(stableValue(value));
const byScope = (left, right) =>
  left.turnScopeId < right.turnScopeId ? -1 : left.turnScopeId > right.turnScopeId ? 1 : 0;

function observeSnapshot(snapshot) {
  return {
    sessionId: snapshot.sessionId,
    sequence: snapshot.sequence,
    activeTurnScopeId: snapshot.activeTurnScopeId,
    turns: [snapshot.activeTurn, ...snapshot.recentTerminalTurns]
      .filter(Boolean)
      .map((turn) => {
        const { thinkingFinishedAt = "", ...record } = snapshotTurn(turn);
        return { turnScopeId: turn.turnScopeId, record: canonical(record), thinkingFinishedAt };
      })
      .sort(byScope),
    replacements: snapshot.replacedTurns
      .map((replacement) => ({
        turnScopeId: replacement.turnScopeId,
        record: canonical(snapshotReplacedTurn(replacement)),
      }))
      .sort(byScope),
  };
}

function reconcileSameSequence(previous, incoming) {
  if (previous.activeTurnScopeId !== incoming.activeTurnScopeId) return false;
  const previousTurns = new Map(previous.turns.map((turn) => [turn.turnScopeId, turn]));
  const previousReplacements = new Map(
    previous.replacements.map((replacement) => [replacement.turnScopeId, replacement]),
  );
  for (const turn of incoming.turns) {
    if (previousReplacements.has(turn.turnScopeId)) return false;
    const existing = previousTurns.get(turn.turnScopeId);
    if (!existing) continue;
    if (existing.record !== turn.record) return false;
    if (
      existing.thinkingFinishedAt &&
      turn.thinkingFinishedAt &&
      existing.thinkingFinishedAt !== turn.thinkingFinishedAt
    )
      return false;

    if (!turn.thinkingFinishedAt) turn.thinkingFinishedAt = existing.thinkingFinishedAt;
  }
  for (const replacement of incoming.replacements) {
    if (previousTurns.has(replacement.turnScopeId)) return false;
    const existing = previousReplacements.get(replacement.turnScopeId);
    if (existing && existing.record !== replacement.record) return false;
  }
  return true;
}

function sameEntries(previous, incoming) {
  return (
    previous.length === incoming.length &&
    previous.every((entry, position) => {
      const next = incoming[position];
      return (
        entry.turnScopeId === next.turnScopeId &&
        entry.record === next.record &&
        entry.thinkingFinishedAt === next.thinkingFinishedAt
      );
    })
  );
}

export function decideTurnLifecycleSnapshotApplication({
  snapshot,
  currentSequence,
  previousObservation,
}) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid)
    return { applied: false, reason: "invalid_authoritative_snapshot", errors: validation.errors };
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 0)
    throw new TypeError("Snapshot application requires the observed lifecycle sequence");
  if (currentSequence > snapshot.sequence) return { applied: false, reason: "stale_snapshot" };
  const observation = observeSnapshot(snapshot);
  if (previousObservation) {
    if (previousObservation.sessionId !== snapshot.sessionId)
      throw new TypeError("Snapshot observation belongs to another session");
    if (previousObservation.sequence > snapshot.sequence)
      return { applied: false, reason: "stale_snapshot" };
  }
  if (previousObservation?.sequence === snapshot.sequence) {
    if (!reconcileSameSequence(previousObservation, observation))
      return { applied: false, reason: "snapshot_sequence_conflict" };
    if (
      sameEntries(previousObservation.turns, observation.turns) &&
      sameEntries(previousObservation.replacements, observation.replacements)
    )
      return { applied: false, deduplicated: true, reason: "duplicate_snapshot" };
  }
  return { applied: true, observation: deepFreeze(observation) };
}
