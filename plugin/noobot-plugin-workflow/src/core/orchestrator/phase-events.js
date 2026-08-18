/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS } from "../constants.js";

export async function startWorkflowPhase({
  phaseTracker,
  phase = "",
} = {}) {
  phaseTracker.start(phase);
}

export async function endWorkflowPhase({
  phaseTracker,
  phase = "",
  status = WORKFLOW_PHASE_STATUS.SUCCEEDED,
  meta = {},
} = {}) {
  phaseTracker.end(phase, status, meta);
}
