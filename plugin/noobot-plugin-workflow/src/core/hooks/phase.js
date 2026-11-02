/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_TRACE } from "../constants.js";

export function appendWorkflowTrace(agentResult, payload) {
  agentResult.traces.push({
    type: WORKFLOW_TRACE.TYPE,
    ...payload,
  });
}
