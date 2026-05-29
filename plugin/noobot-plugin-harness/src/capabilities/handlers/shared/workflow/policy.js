/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

export const GUIDANCE_PRIORITY_ORDER = Object.freeze([
  ...WORKFLOW_PARAMS.guidance.scheduler.priorityOrder,
]);

export const ACCEPTANCE_PHASE_BLOCKER_KEYS = Object.freeze([
  ...WORKFLOW_PARAMS.acceptance.phase.blockerKeys,
]);

export function hasAcceptancePhaseBlockers(state = {}) {
  const pending = state?.pending && typeof state.pending === "object" ? state.pending : {};
  return (
    pending.summary === true ||
    Boolean(pending.guidance) ||
    pending.planUpdate === true ||
    state?.flags?.planningCaptured !== true
  );
}
