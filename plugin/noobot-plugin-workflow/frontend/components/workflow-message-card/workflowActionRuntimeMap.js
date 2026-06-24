/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { makeActionStateKey, makeRuntimeStep } from "./workflowRuntimeSteps.js";

export function createActionRuntimeBySemanticKey({ runtimeNodeSessions, workflowPayload, nodeRunByDialogProcessId, resolveStepStatus }) {
  return computed(() => {
    const map = new Map();
    const ensureNodeRuntime = (item = {}) => {
      const nodeId = String(item?.nodeId || "").trim();
      const nodeName = String(item?.nodeName || "").trim();
      const primaryKey = nodeId ? `id:${nodeId}` : nodeName ? `name:${nodeName}` : "";
      if (!primaryKey) return null;
      if (!map.has(primaryKey)) {
        const runtime = {
          nodeId,
          nodeName,
          actionNodeStates: [],
          _stateMap: new Map(),
        };
        map.set(primaryKey, runtime);
        if (nodeId) map.set(`id:${nodeId}`, runtime);
        if (nodeName) map.set(`name:${nodeName}`, runtime);
      }
      return map.get(primaryKey);
    };

    runtimeNodeSessions.value.forEach((item = {}, index) => {
      const runtime = ensureNodeRuntime(item);
      if (!runtime) return;
      const stateKey = makeActionStateKey(item, index);
      if (!runtime._stateMap.has(stateKey)) {
        runtime._stateMap.set(stateKey, {
          actionNodeStateId: stateKey,
          nodeId: String(item?.nodeId || runtime.nodeId || "").trim(),
          nodeName: String(item?.nodeName || runtime.nodeName || "").trim(),
          steps: [],
        });
        runtime.actionNodeStates.push(runtime._stateMap.get(stateKey));
      }
      runtime._stateMap.get(stateKey).steps.push(
        makeRuntimeStep({ item, index, workflowPayload, nodeRunByDialogProcessId, resolveStepStatus }),
      );
    });

    for (const runtime of new Set(map.values())) {
      runtime.actionNodeStates.sort((left, right) => {
        const leftOrder = Number(left?.steps?.[0]?.transition ?? left?.steps?.[0]?.stepIndex ?? 0);
        const rightOrder = Number(right?.steps?.[0]?.transition ?? right?.steps?.[0]?.stepIndex ?? 0);
        return leftOrder - rightOrder;
      });
      for (const stateBox of runtime.actionNodeStates) {
        stateBox.steps.sort((left, right) => Number(left?.stepIndex || 0) - Number(right?.stepIndex || 0));
      }
    }
    return map;
  });
}
