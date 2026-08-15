/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  canonicalTurnScopeId,
  ensureSessionBucket,
  isTurnRuntimeDeleted,
  runtimeText,
} from "./turnRuntimeRegistryIdentity.js";

export function applyTurnTimingUpdate(registry, update = {}) {
  const sessionId = runtimeText(update?.sessionId);
  const turnScopeId = canonicalTurnScopeId(update?.turnScopeId);
  const dialogProcessId = runtimeText(update?.dialogProcessId);
  const startedAt = runtimeText(update?.thinkingStartedAt || update?.startedAt);
  const finishedAt = runtimeText(update?.thinkingFinishedAt || update?.finishedAt);
  if (!sessionId || !turnScopeId) return { applied: false, reason: "missing_timing_identity" };
  if (!startedAt && !finishedAt) return { applied: false, reason: "missing_timing_value" };
  if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) {
    return { applied: false, reason: "turn_runtime_deleted" };
  }
  const bucket = ensureSessionBucket(registry, sessionId);
  const current = bucket.turns[turnScopeId] || {};
  if (
    current?.dialogProcessId &&
    dialogProcessId &&
    runtimeText(current.dialogProcessId) !== dialogProcessId
  ) {
    return { applied: false, reason: "dialog_process_identity_conflict" };
  }
  const nextStartedAt = runtimeText(current.startedAt || startedAt);
  const nextFinishedAt = runtimeText(current.finishedAt || finishedAt);
  const nextDialogProcessId = runtimeText(current.dialogProcessId || dialogProcessId);
  const canonicalTimingObserved =
    update.canonical === true || current.canonicalTimingObserved === true;
  if (
    runtimeText(current.startedAt) === nextStartedAt &&
    runtimeText(current.finishedAt) === nextFinishedAt &&
    runtimeText(current.dialogProcessId) === nextDialogProcessId &&
    current.canonicalTimingObserved === canonicalTimingObserved
  ) {
    return { applied: false, deduplicated: true, reason: "timing_unchanged", turn: current };
  }
  const turn = {
    ...current,
    sessionId,
    turnScopeId,
    dialogProcessId: nextDialogProcessId,
    startedAt: nextStartedAt,
    finishedAt: nextFinishedAt,
    startedAtMs: nextStartedAt ? Date.parse(nextStartedAt) || 0 : Number(current.startedAtMs || 0),
    finishedAtMs: nextFinishedAt
      ? Date.parse(nextFinishedAt) || 0
      : Number(current.finishedAtMs || 0),
    canonicalTimingObserved,
    timingSource: runtimeText(update?.source || current.timingSource || "turn_runtime_event"),
  };
  bucket.turns[turnScopeId] = turn;
  if (nextDialogProcessId) registry.routeIndex[nextDialogProcessId] = { sessionId, turnScopeId };
  return { applied: true, bucket, turn };
}

export function applyTurnTimingSnapshot(registry, snapshot = {}) {
  const sessionId = runtimeText(snapshot?.sessionId);
  const sourceTimings = Array.isArray(snapshot?.turnTimings) ? snapshot.turnTimings : [];
  if (!sessionId) return { applied: false, reason: "missing_session_identity" };
  if (!sourceTimings.length) return { applied: false, reason: "empty_timing_snapshot" };
  const timings = sourceTimings.map((item = {}) => ({
    turnScopeId: canonicalTurnScopeId(item?.turnScopeId),
    dialogProcessId: runtimeText(item?.dialogProcessId),
    startedAt: runtimeText(item?.thinkingStartedAt || item?.startedAt),
    finishedAt: runtimeText(item?.thinkingFinishedAt || item?.finishedAt),
  }));
  if (timings.some((item) => !item.turnScopeId || (!item.startedAt && !item.finishedAt))) {
    return { applied: false, reason: "invalid_timing_snapshot" };
  }
  const bucket = ensureSessionBucket(registry, sessionId);
  const hydratedTurnScopeIds = [];
  for (const timing of timings) {
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId: timing.turnScopeId })) continue;
    const result = applyTurnTimingUpdate(registry, {
      sessionId,
      turnScopeId: timing.turnScopeId,
      dialogProcessId: timing.dialogProcessId,
      startedAt: timing.startedAt,
      finishedAt: timing.finishedAt,
      canonical: true,
      source: "session_turn_timing_snapshot",
    });
    if (result.reason === "dialog_process_identity_conflict") return result;
    if (result.applied) hydratedTurnScopeIds.push(timing.turnScopeId);
  }
  return hydratedTurnScopeIds.length
    ? { applied: true, bucket, hydratedTurnScopeIds }
    : { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
}
