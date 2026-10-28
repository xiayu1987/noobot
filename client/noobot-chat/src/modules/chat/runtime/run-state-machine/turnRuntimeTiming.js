/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import {
  assertTurnTimingOwnership,
  normalizeTurnTimingRecord,
  mergeTurnTimingRecord,
} from "@noobot/session-protocol";
import { ensureSessionBucket, isTurnRuntimeDeleted } from "./turnRuntimeRegistryIdentity.js";

function normalizeSnapshotTimings(turnTimings) {
  return turnTimings.map((item) => normalizeTurnTimingRecord(item));
}

function isSameTiming(left, right) {
  return (
    Boolean(right) &&
    left.thinkingFinishedAt === right.thinkingFinishedAt &&
    left.modelLoopRound === right.modelLoopRound
  );
}

export function mergeAuthoritativeTurnTiming(currentTiming, authoritativeTurn) {
  const thinkingFinishedAt = text(authoritativeTurn.thinkingFinishedAt);
  if (!thinkingFinishedAt) return currentTiming;
  const incoming = {
    turnScopeId: authoritativeTurn.turnScopeId,
    dialogProcessId: authoritativeTurn.dialogProcessId,
    thinkingFinishedAt,
  };
  return currentTiming
    ? mergeTurnTimingRecord(currentTiming, incoming)
    : normalizeTurnTimingRecord(incoming);
}

function applyTurnTiming(registry, bucket, sessionId, timing) {
  const current = bucket.turns[timing.turnScopeId] || {};
  assertTurnTimingOwnership(timing, current.dialogProcessId);
  const merged = current.timing ? mergeTurnTimingRecord(current.timing, timing) : timing;
  if (isSameTiming(merged, current.timing)) {
    return { applied: false, deduplicated: true };
  }
  bucket.turns[timing.turnScopeId] = {
    ...current,
    sessionId,
    turnScopeId: timing.turnScopeId,
    dialogProcessId: timing.dialogProcessId,
    timing: merged,
  };
  registry.routeIndex[timing.dialogProcessId] = { sessionId, turnScopeId: timing.turnScopeId };
  return { applied: true };
}

export function applyTurnTimingSnapshot(registry, snapshot) {
  const sessionId = text(snapshot.sessionId);
  if (!sessionId) throw new TypeError("turn timing snapshot requires sessionId");
  if (!Array.isArray(snapshot.turnTimings)) {
    throw new TypeError(`turn timing snapshot requires turnTimings array: ${sessionId}`);
  }
  const timings = normalizeSnapshotTimings(snapshot.turnTimings);
  const bucket = ensureSessionBucket(registry, sessionId);
  const hydratedTurnScopeIds = [];
  for (const timing of timings) {
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId: timing.turnScopeId })) continue;
    if (applyTurnTiming(registry, bucket, sessionId, timing).applied) {
      hydratedTurnScopeIds.push(timing.turnScopeId);
    }
  }
  return hydratedTurnScopeIds.length
    ? { applied: true, bucket, hydratedTurnScopeIds }
    : { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
}
