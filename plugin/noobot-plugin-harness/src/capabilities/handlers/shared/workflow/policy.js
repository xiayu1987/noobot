/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { assertHarnessState } from "../../../../core/bucket-contract.js";

export const ACCEPTANCE_PHASE_BLOCKER_KEYS = Object.freeze([
  ...WORKFLOW_PARAMS.acceptance.phase.blockerKeys,
]);

export function hasAcceptancePhaseBlockers(state) {
  const { pending, flags } = assertHarnessState(state);
  const hasPlanUpdatePending = pending.planRevision === true || pending.planRefinement === true;
  return Boolean(pending.guidance) || hasPlanUpdatePending || flags.planningCaptured !== true;
}
