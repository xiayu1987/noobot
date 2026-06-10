/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS } from "../constants.js";
import { emitWorkflowRuntimeEvent } from "../hooks/persistence.js";

export async function startWorkflowPhase({
  phaseTracker,
  phase = "",
  options = {},
  ctx = {},
  event = "",
  data = undefined,
} = {}) {
  phaseTracker.start(phase);
  if (!event) return;
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event,
    ...(data === undefined ? {} : { data }),
  });
}

export async function endWorkflowPhase({
  phaseTracker,
  phase = "",
  status = WORKFLOW_PHASE_STATUS.SUCCEEDED,
  meta = {},
  options = {},
  ctx = {},
  event = "",
  data = undefined,
  level = undefined,
} = {}) {
  phaseTracker.end(phase, status, meta);
  if (!event) return;
  await emitWorkflowRuntimeEvent({
    options,
    ctx,
    event,
    ...(data === undefined ? {} : { data }),
    ...(level === undefined ? {} : { level }),
  });
}
