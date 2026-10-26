/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export {
  areCanonicalTurnScopeIdsEqual,
  createMemoryPostprocessIdentity,
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
  isCanonicalTurnScopeId,
  isOptionalCanonicalTurnScopeId,
  isWorkflowNodeTurnScopeId,
  requireCanonicalTurnScopeId,
  requireOptionalCanonicalTurnScopeId,
  MEMORY_POSTPROCESS_DIALOG_PROCESS_PREFIX,
  MEMORY_POSTPROCESS_TURN_SCOPE_PREFIX,
  WORKFLOW_NODE_DIALOG_PROCESS_PREFIX,
  WORKFLOW_NODE_TURN_SCOPE_PREFIX,
} from "./identity/turn-scope-identity.js";
