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
  if (!authoritativeTurn.thinkingFinishedAt) return currentTiming;
  const incoming = {
    turnScopeId: authoritativeTurn.turnScopeId,
    dialogProcessId: authoritativeTurn.dialogProcessId,
    thinkingFinishedAt: authoritativeTurn.thinkingFinishedAt,
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
  const staged = {
    ...registry,
    sessions: { ...registry.sessions },
    routeIndex: { ...registry.routeIndex },
  };
  const existing = registry.sessions[sessionId];
  if (existing) staged.sessions[sessionId] = { ...existing, turns: { ...existing.turns } };
  const preparedBucket = ensureSessionBucket(staged, sessionId);
  const hydratedTurnScopeIds = [];
  for (const timing of timings) {
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId: timing.turnScopeId })) continue;
    if (applyTurnTiming(staged, preparedBucket, sessionId, timing).applied) {
      hydratedTurnScopeIds.push(timing.turnScopeId);
    }
  }
  if (!hydratedTurnScopeIds.length) {
    return { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
  }
  const bucket = ensureSessionBucket(registry, sessionId);
  Object.assign(bucket.turns, preparedBucket.turns);
  Object.assign(registry.routeIndex, staged.routeIndex);
  return { applied: true, bucket, hydratedTurnScopeIds };
}
