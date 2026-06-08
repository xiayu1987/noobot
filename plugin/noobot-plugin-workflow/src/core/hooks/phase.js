/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PHASE_STATUS, WORKFLOW_TRACE } from "../constants.js";

export function appendWorkflowTrace(agentResult = {}, payload = {}) {
  const traces = Array.isArray(agentResult?.traces) ? agentResult.traces : [];
  traces.push({
    type: WORKFLOW_TRACE.TYPE,
    ...payload,
  });
  agentResult.traces = traces;
}

export function createPhaseTracker() {
  const phases = [];
  return {
    start(name = "", meta = {}) {
      phases.push({
        phase: String(name || "").trim(),
        status: WORKFLOW_PHASE_STATUS.STARTED,
        startedAt: new Date().toISOString(),
        ...meta,
      });
    },
    end(name = "", status = WORKFLOW_PHASE_STATUS.SUCCEEDED, meta = {}) {
      const phaseName = String(name || "").trim();
      const now = new Date().toISOString();
      const openIdx = [...phases]
        .reverse()
        .findIndex(
          (item) =>
            item.phase === phaseName &&
            item.status === WORKFLOW_PHASE_STATUS.STARTED &&
            !item.endedAt,
        );
      if (openIdx >= 0) {
        const realIdx = phases.length - 1 - openIdx;
        phases[realIdx] = {
          ...phases[realIdx],
          status,
          endedAt: now,
          ...meta,
        };
      } else {
        phases.push({
          phase: phaseName,
          status,
          endedAt: now,
          ...meta,
        });
      }
    },
    list() {
      return phases.slice();
    },
  };
}
