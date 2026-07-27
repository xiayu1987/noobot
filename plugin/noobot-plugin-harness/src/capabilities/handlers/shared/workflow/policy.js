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
  return (
    Boolean(pending.guidance) ||
    hasPlanUpdatePending ||
    state?.flags?.planningCaptured !== true
  );
}
