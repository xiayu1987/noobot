/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_NODE_STATUS,
  isWorkflowNodeTerminalStatus,
  normalizeWorkflowNodeStatus,
} from "@noobot/event-protocol/workflow-runtime-event";

const STATUS_LABEL_KEYS = Object.freeze({
  [WORKFLOW_NODE_STATUS.PENDING]: "workflow.statusPending",
  [WORKFLOW_NODE_STATUS.READY]: "workflow.statusReady",
  [WORKFLOW_NODE_STATUS.RUNNING]: "workflow.statusRunning",
  [WORKFLOW_NODE_STATUS.SUCCEEDED]: "workflow.statusSucceeded",
  [WORKFLOW_NODE_STATUS.FAILED]: "workflow.statusFailed",
  [WORKFLOW_NODE_STATUS.STOPPED]: "workflow.statusStopped",
  [WORKFLOW_NODE_STATUS.SKIPPED]: "workflow.statusSkipped",
});

export function resolveWorkflowNodeStatus(item = {}) {
  return normalizeWorkflowNodeStatus(item?.status) || WORKFLOW_NODE_STATUS.PENDING;
}

export function resolveWorkflowNodeStatusLabelKey(item = {}) {
  return STATUS_LABEL_KEYS[resolveWorkflowNodeStatus(item)];
}

export function isWorkflowNodeFinished(item = {}) {
  return isWorkflowNodeTerminalStatus(resolveWorkflowNodeStatus(item));
}

export function resolveActionRuntimeStatus(actionNodeStates = []) {
  const statuses = [];
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : [])
      statuses.push(resolveWorkflowNodeStatus(stepItem));
  }
  if (!statuses.length) return WORKFLOW_NODE_STATUS.PENDING;
  if (statuses.includes(WORKFLOW_NODE_STATUS.RUNNING)) return WORKFLOW_NODE_STATUS.RUNNING;
  if (statuses.includes(WORKFLOW_NODE_STATUS.FAILED)) return WORKFLOW_NODE_STATUS.FAILED;
  if (statuses.includes(WORKFLOW_NODE_STATUS.STOPPED)) return WORKFLOW_NODE_STATUS.STOPPED;
  if (statuses.every((status) => status === WORKFLOW_NODE_STATUS.SKIPPED))
    return WORKFLOW_NODE_STATUS.SKIPPED;
  if (statuses.every(isWorkflowNodeTerminalStatus)) return WORKFLOW_NODE_STATUS.SUCCEEDED;
  if (statuses.includes(WORKFLOW_NODE_STATUS.READY)) return WORKFLOW_NODE_STATUS.READY;
  return WORKFLOW_NODE_STATUS.PENDING;
}
