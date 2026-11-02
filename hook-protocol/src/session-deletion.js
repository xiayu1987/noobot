/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { HookExecutionError, HOOK_OUTCOME_STATUS } from "./runtime.js";
import { HOOK_POINT } from "./points.js";

function normalizeSessionIds(sessionIds = []) {
  if (!Array.isArray(sessionIds)) return [];
  return [...new Set(sessionIds.map((value) => text(value)).filter(Boolean))];
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
  if (!Array.isArray(hookResult.outcomes)) {
    throw new TypeError("session deletion hook requires outcomes");
  }
  if (hookResult.outcomes.some((outcome) => outcome.status !== HOOK_OUTCOME_STATUS.OK)) {
    throw new HookExecutionError({
      point: HOOK_POINT.SERVICE.AFTER_SESSION_DELETE,
      outcomes: hookResult.outcomes,
    });
  }
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

export function resolveSessionDeletionTargets(context = {}) {
  const deletedSessionIds = normalizeSessionIds(context?.deletedSessionIds);
  if (!deletedSessionIds.length) {
    throw new TypeError("session deletion hook context requires non-empty deletedSessionIds");
  }
  return deletedSessionIds;
}
