/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot as getWorkflowInstanceSnapshotById,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance as releaseWorkflowInstanceById,
} from "workflow";
import { parseWorkflowDslText } from "../protocol/text-protocol.js";
import { WORKFLOW_PLUGIN_DEFAULTS } from "../core/constants.js";
import { mountConditionModelBoxFactory } from "../extensions/workflow/condition-model-box-factory.js";

export function executeWorkflowText({ semanticText = "", options = {} } = {}) {
  const semantic = parseWorkflowDslText(semanticText);
  return { semantic };
}

export function createWorkflowInstance({ instanceId = "", semantic = {}, options = {}, meta = {} } = {}) {
  mountConditionModelBoxFactory();
  return startWorkflowInstanceById({
    instanceId,
    semantic,
    options: {
      maxAutoTransitions:
        Number.isFinite(Number(options?.maxAutoTransitions)) && Number(options.maxAutoTransitions) > 0
          ? Math.floor(Number(options.maxAutoTransitions))
          : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
      conditionContext:
        options?.conditionContext && typeof options.conditionContext === "object"
          ? options.conditionContext
          : undefined,
    },
    meta,
  });
}

export function getWorkflowInstanceSnapshot({ instanceId = "" } = {}) {
  return getWorkflowInstanceSnapshotById({ instanceId });
}

export function advanceWorkflowInstance({ instanceId = "", action = { type: "submit", stepIndex: 0 } } = {}) {
  return advanceWorkflowInstanceById({ instanceId, action });
}

export function releaseWorkflowInstance({ instanceId = "" } = {}) {
  return releaseWorkflowInstanceById({ instanceId });
}
