/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "../normalize.js";

const WORKFLOW_NODE_CANONICAL_PREFIX = "workflow-node:";
const WORKFLOW_NODE_TRANSPORT_PREFIX = "workflow-node_";

export const WORKFLOW_NODE_TURN_SCOPE_PREFIX = WORKFLOW_NODE_CANONICAL_PREFIX;
export const WORKFLOW_NODE_DIALOG_PROCESS_PREFIX = "wf_node_";

export function canonicalizeTurnScopeId(value = "") {
  const turnScopeId = text(value);
  if (turnScopeId.startsWith(WORKFLOW_NODE_TRANSPORT_PREFIX)) {
    return `${WORKFLOW_NODE_CANONICAL_PREFIX}${turnScopeId.slice(WORKFLOW_NODE_TRANSPORT_PREFIX.length)}`;
  }
  return turnScopeId;
}

export function isCanonicalTurnScopeId(value = "") {
  const normalized = text(value);
  return Boolean(normalized) && normalized === canonicalizeTurnScopeId(normalized);
}

export function turnScopeIdentityKey(value = "") {
  const canonical = canonicalizeTurnScopeId(value);
  if (!canonical) return "";
  if (canonical.startsWith(WORKFLOW_NODE_CANONICAL_PREFIX)) {
    return `${WORKFLOW_NODE_TRANSPORT_PREFIX}${canonical.slice(WORKFLOW_NODE_CANONICAL_PREFIX.length)}`;
  }
  return canonical;
}

export function areCanonicalTurnScopeIdsEqual(left = "", right = "") {
  const leftKey = turnScopeIdentityKey(left);
  const rightKey = turnScopeIdentityKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function createWorkflowNodeTurnScopeId(nodeExecutionId = "") {
  const normalized = text(nodeExecutionId);
  return normalized ? `${WORKFLOW_NODE_TURN_SCOPE_PREFIX}${normalized}` : "";
}

export function createWorkflowNodeDialogProcessId(nodeExecutionId = "") {
  const normalized = text(nodeExecutionId);
  return normalized ? `${WORKFLOW_NODE_DIALOG_PROCESS_PREFIX}${normalized}` : "";
}

export function isWorkflowNodeTurnScopeId(value = "") {
  return canonicalizeTurnScopeId(value).startsWith(WORKFLOW_NODE_TURN_SCOPE_PREFIX);
}

export function isWorkflowNodeDialogProcessId(value = "") {
  return text(value).startsWith(WORKFLOW_NODE_DIALOG_PROCESS_PREFIX);
}

export function readWorkflowNodeExecutionId(value = "") {
  const canonical = canonicalizeTurnScopeId(value);
  return canonical.startsWith(WORKFLOW_NODE_TURN_SCOPE_PREFIX)
    ? canonical.slice(WORKFLOW_NODE_TURN_SCOPE_PREFIX.length)
    : "";
}
