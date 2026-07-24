/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value || "").trim();
}

export function findCanonicalTurnTiming(session = null, turnScopeId = "") {
  const scope = text(turnScopeId);
  if (!scope) return null;
  return (Array.isArray(session?.turnTimings) ? session.turnTimings : [])
    .find((item) => text(item?.turnScopeId) === scope) || null;
}

/** Merge canonical Session timing over disposable projection/fallback values. */
export function mergeCanonicalTurnTiming(session = null, turnScopeId = "", fallback = {}) {
  const canonical = findCanonicalTurnTiming(session, turnScopeId) || {};
  const projected = session?.turnTimingsByTurnScopeId?.[text(turnScopeId)] || {};
  return {
    ...fallback,
    ...projected,
    ...canonical,
    startedAt: text(canonical.thinkingStartedAt || projected.thinkingStartedAt || fallback.startedAt),
    finishedAt: text(canonical.thinkingFinishedAt || projected.thinkingFinishedAt || fallback.finishedAt),
  };
}
