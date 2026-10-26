/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  EStateType,
  startWorkflowInstanceById,
  resolveWorkflowUpstreamActionSteps as resolveWorkflowUpstreamActionStepsByRuntime,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance as releaseWorkflowInstanceById,
} from "workflow";
import {
  WORKFLOW_NODE_TYPE,
  WORKFLOW_STATE_TYPE,
} from "@noobot/event-protocol/workflow-runtime-event";
import { parseWorkflowDslText } from "../protocol/text-protocol.js";
import { mountWorkflowExtensions } from "../extensions/workflow/runtime.js";

const ENGINE_STATE_TYPE_BY_PROTOCOL = Object.freeze({
  [WORKFLOW_STATE_TYPE.START]: EStateType.Start,
  [WORKFLOW_STATE_TYPE.END]: EStateType.End,
  [WORKFLOW_STATE_TYPE.BRANCH]: EStateType.Branch,
  [WORKFLOW_STATE_TYPE.MERGE]: EStateType.Merge,
});

function toEngineNode(node) {
  if (node.type !== WORKFLOW_NODE_TYPE.STATE) return node;
  if (!Object.hasOwn(ENGINE_STATE_TYPE_BY_PROTOCOL, node.stateType)) {
    throw new Error(`workflow state node ${node.id} has invalid stateType: ${node.stateType}`);
  }
  return { ...node, stateType: ENGINE_STATE_TYPE_BY_PROTOCOL[node.stateType] };
}

function toEngineSemantic(semantic) {
  return { ...semantic, nodes: semantic.nodes.map(toEngineNode) };
}

export function parseWorkflowSemantic({ semanticText, options }) {
  return parseWorkflowDslText(semanticText, { locale: options.locale });
}

export function createWorkflowInstance({ instanceId, semantic, options, meta }) {
  mountWorkflowExtensions({ options, meta });
  return startWorkflowInstanceById({ instanceId, semantic: toEngineSemantic(semantic) });
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
