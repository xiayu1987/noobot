/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isCanonicalText } from "@noobot/shared/value";

export const WORKFLOW_NODE_TURN_SCOPE_PREFIX = "workflow-node:";
export const WORKFLOW_NODE_DIALOG_PROCESS_PREFIX = "wf_node_";
export const MEMORY_POSTPROCESS_TURN_SCOPE_PREFIX = "memory-postprocess:";
export const MEMORY_POSTPROCESS_DIALOG_PROCESS_PREFIX = "mem_";

function identityError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

export function isCanonicalTurnScopeId(value) {
  return isCanonicalText(value);
}

export function isOptionalCanonicalTurnScopeId(value) {
  return value === "" || isCanonicalTurnScopeId(value);
}

export function requireCanonicalTurnScopeId(value) {
  if (isCanonicalTurnScopeId(value)) return value;
  throw identityError("TURN_SCOPE_ID_INVALID", `invalid turnScopeId: "${String(value)}"`);
}

export function requireOptionalCanonicalTurnScopeId(value) {
  if (isOptionalCanonicalTurnScopeId(value)) return value;
  throw identityError("TURN_SCOPE_ID_INVALID", `invalid optional turnScopeId: "${String(value)}"`);
}

export function areCanonicalTurnScopeIdsEqual(left, right) {
  return isCanonicalTurnScopeId(left) && left === right;
}

function requireNodeExecutionId(nodeExecutionId) {
  if (isCanonicalText(nodeExecutionId)) return nodeExecutionId;
  throw identityError(
    "WORKFLOW_NODE_IDENTITY_INVALID",
    `invalid workflow nodeExecutionId: "${String(nodeExecutionId)}"`,
  );
}

export function createWorkflowNodeTurnScopeId(nodeExecutionId) {
  return `${WORKFLOW_NODE_TURN_SCOPE_PREFIX}${requireNodeExecutionId(nodeExecutionId)}`;
}

export function createWorkflowNodeDialogProcessId(nodeExecutionId) {
  return `${WORKFLOW_NODE_DIALOG_PROCESS_PREFIX}${requireNodeExecutionId(nodeExecutionId)}`;
}

export function isWorkflowNodeTurnScopeId(value) {
  return isCanonicalTurnScopeId(value) && value.startsWith(WORKFLOW_NODE_TURN_SCOPE_PREFIX);
}

export function createMemoryPostprocessIdentity({ sessionId, sourceDialogProcessId }) {
  if (!isCanonicalText(sessionId) || !isCanonicalText(sourceDialogProcessId)) {
    throw identityError(
      "MEMORY_POSTPROCESS_IDENTITY_INVALID",
      "memory postprocess identity requires sessionId and sourceDialogProcessId",
    );
  }
  const digest = bytesToHex(sha256(utf8ToBytes(`${sessionId}\n${sourceDialogProcessId}`))).slice(
    0,
    32,
  );
  const turnScopeId = `${MEMORY_POSTPROCESS_TURN_SCOPE_PREFIX}${sourceDialogProcessId}`;
  return Object.freeze({
    dialogProcessId: `${MEMORY_POSTPROCESS_DIALOG_PROCESS_PREFIX}${digest}`,
    turnScopeId,
    runId: turnScopeId,
  });
}
