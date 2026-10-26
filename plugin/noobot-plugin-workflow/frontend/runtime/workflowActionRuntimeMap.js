/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { makeRuntimeStep } from "./workflowRuntimeSteps.js";

export function createActionRuntimeByNodeId({ runtimeNodeSessions, workflowPayload }) {
  return computed(() => {
    const map = new Map();
    for (const item of runtimeNodeSessions.value) {
      if (!map.has(item.nodeId)) map.set(item.nodeId, { actionNodeStates: [] });
      map.get(item.nodeId).actionNodeStates.push({
        nodeExecutionId: item.nodeExecutionId,
        steps: [makeRuntimeStep({ item, workflowPayload })],
      });
    }
    return map;
  });
}
