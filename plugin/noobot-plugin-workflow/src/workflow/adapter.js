/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  startWorkflowInstanceById,
  resolveWorkflowUpstreamActionSteps as resolveWorkflowUpstreamActionStepsByRuntime,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance as releaseWorkflowInstanceById,
} from "workflow";
import { parseWorkflowDslText } from "../protocol/text-protocol.js";
import { mountWorkflowExtensions } from "../extensions/workflow/runtime.js";

export function parseWorkflowSemantic({ semanticText, options }) {
  return parseWorkflowDslText(semanticText, { locale: options.locale });
}

export function createWorkflowInstance({ instanceId, semantic, options, meta }) {
  mountWorkflowExtensions({ options, meta });
  return startWorkflowInstanceById({ instanceId, semantic });
}

export function resolveWorkflowUpstreamActionSteps({ instanceId, stepId }) {
  return resolveWorkflowUpstreamActionStepsByRuntime({ instanceId, stepId });
}

export function advanceWorkflowInstance({ instanceId, action }) {
  return advanceWorkflowInstanceById({ instanceId, action });
}

export function releaseWorkflowInstance({ instanceId }) {
  return releaseWorkflowInstanceById({ instanceId });
}
