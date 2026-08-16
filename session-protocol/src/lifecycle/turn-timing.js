/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export function normalizeTurnTiming(timing = {}) {
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) return null;
  const turnScopeId = clean(timing.turnScopeId);
  if (!turnScopeId) return null;
  const normalized = { turnScopeId, dialogProcessId: clean(timing.dialogProcessId) };
  if (clean(timing.thinkingStartedAt))
    normalized.thinkingStartedAt = clean(timing.thinkingStartedAt);
  if (clean(timing.thinkingFinishedAt))
    normalized.thinkingFinishedAt = clean(timing.thinkingFinishedAt);
  return normalized;
}

export function normalizeTurnTimings(timings = []) {
  const byTurnScopeId = new Map();
  for (const item of Array.isArray(timings) ? timings : []) {
    const timing = normalizeTurnTiming(item);
    if (timing)
      byTurnScopeId.set(timing.turnScopeId, {
        ...(byTurnScopeId.get(timing.turnScopeId) || {}),
        ...timing,
      });
  }
  return [...byTurnScopeId.values()];
}

export function projectTurnTiming(turn = {}, timings = []) {
  const timing = normalizeTurnTimings(timings).find(
    (item) => item.turnScopeId === clean(turn.turnScopeId),
  );
  return {
    ...turn,
    thinkingStartedAt: clean(timing?.thinkingStartedAt),
    thinkingFinishedAt: clean(timing?.thinkingFinishedAt),
  };
}
