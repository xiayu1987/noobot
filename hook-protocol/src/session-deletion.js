/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeSessionIds(sessionIds = []) {
  if (!Array.isArray(sessionIds)) return [];
  return [...new Set(sessionIds.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function createSessionDeletionHookResult({
  deletedRelatedSessionIds = [],
  retainedRelatedSessionIds = [],
} = {}) {
  return Object.freeze({
    deletedRelatedSessionIds: Object.freeze(normalizeSessionIds(deletedRelatedSessionIds)),
    retainedRelatedSessionIds: Object.freeze(normalizeSessionIds(retainedRelatedSessionIds)),
  });
}

function collectSessionDeletionResultIds(hookResult = {}, field = "") {
  const outcomes = Array.isArray(hookResult?.outcomes) ? hookResult.outcomes : [];
  return normalizeSessionIds(
    outcomes.flatMap((outcome) =>
      outcome?.status === "ok" && Array.isArray(outcome?.value?.[field])
        ? outcome.value[field]
        : [],
    ),
  );
}

export function collectSessionDeletionHookResult(hookResult = {}) {
  return Object.freeze({
    deletedRelatedSessionIds: Object.freeze(
      collectSessionDeletionResultIds(hookResult, "deletedRelatedSessionIds"),
    ),
    retainedRelatedSessionIds: Object.freeze(
      collectSessionDeletionResultIds(hookResult, "retainedRelatedSessionIds"),
    ),
  });
}

export function mergeSessionDeletionIds(...sessionIdGroups) {
  return normalizeSessionIds(sessionIdGroups.flat());
}
