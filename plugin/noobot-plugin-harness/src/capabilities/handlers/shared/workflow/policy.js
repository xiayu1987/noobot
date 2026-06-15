/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

export const ACCEPTANCE_PHASE_BLOCKER_KEYS = Object.freeze([
  ...WORKFLOW_PARAMS.acceptance.phase.blockerKeys,
]);

export function hasAcceptancePhaseBlockers(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  const hasPlanUpdatePending = pending.planRevision === true || pending.planRefinement === true;
  // Cache-friendly orchestration: a pending summary alone should not block
  // phase acceptance. Summary may rewrite/prune history and reduce provider
  // prefix-cache hits, while phase acceptance can usually run against the
  // existing stable context. Hard overflow is handled separately by the
  // forced-acceptance path.
  return (
    Boolean(pending.guidance) ||
    hasPlanUpdatePending ||
    state?.flags?.planningCaptured !== true
  );
}
