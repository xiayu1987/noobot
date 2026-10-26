/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { normalizeTurnTimingRecord, mergeTurnTimingRecord } from "@noobot/session-protocol";
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

function applyTurnTiming(registry, bucket, sessionId, timing) {
  const current = bucket.turns[timing.turnScopeId] || {};
  if (text(current.dialogProcessId) && text(current.dialogProcessId) !== timing.dialogProcessId) {
    return { applied: false, reason: "timing_dialog_process_conflict" };
  }
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

export function applyTurnTimingSnapshot(registry, snapshot = {}) {
  const sessionId = text(snapshot?.sessionId);
  if (!sessionId) return { applied: false, reason: "missing_session_identity" };
  if (!Array.isArray(snapshot?.turnTimings) || !snapshot.turnTimings.length) {
    return { applied: false, reason: "empty_timing_snapshot" };
  }
  const timings = normalizeSnapshotTimings(snapshot.turnTimings);
  const bucket = ensureSessionBucket(registry, sessionId);
  const hydratedTurnScopeIds = [];
  for (const timing of timings) {
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId: timing.turnScopeId })) continue;
    const result = applyTurnTiming(registry, bucket, sessionId, timing);
    if (result.reason) return result;
    if (result.applied) hydratedTurnScopeIds.push(timing.turnScopeId);
  }
  return hydratedTurnScopeIds.length
    ? { applied: true, bucket, hydratedTurnScopeIds }
    : { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
}
