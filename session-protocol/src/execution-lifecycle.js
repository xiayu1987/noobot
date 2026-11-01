/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject, text as clean } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "./turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./lifecycle/turn-capability.js";
import { normalizeTurnExecutionState } from "./lifecycle/turn-execution-state.js";

export const EXECUTION_KIND = Object.freeze({
  AGENT: "agent",
  WORKFLOW: "workflow",
});

export const EXECUTION_TREE_WIRE_EVENT = "execution_tree";
export const EXECUTION_SNAPSHOT_WIRE_EVENT = "execution_snapshot";
export const EXECUTION_CHILDREN_WIRE_EVENT = "execution_children";

export const EXECUTION_QUERY_COMMAND = Object.freeze({
  SNAPSHOT_GET: "execution.snapshot.get",
  CHILDREN_GET: "execution.children.get",
  TREE_GET: "execution.tree.get",
});

export const EXECUTION_QUERY_CONTRACT = Object.freeze({
  [EXECUTION_QUERY_COMMAND.SNAPSHOT_GET]: Object.freeze({
    wireEvent: EXECUTION_SNAPSHOT_WIRE_EVENT,
    requiresExecutionId: true,
  }),
  [EXECUTION_QUERY_COMMAND.CHILDREN_GET]: Object.freeze({
    wireEvent: EXECUTION_CHILDREN_WIRE_EVENT,
    requiresExecutionId: true,
  }),
  [EXECUTION_QUERY_COMMAND.TREE_GET]: Object.freeze({
    wireEvent: EXECUTION_TREE_WIRE_EVENT,
    requiresExecutionId: false,
  }),
});

export function isExecutionQueryTargetValid(
  commandType,
  { executionId = "", rootExecutionId = "" } = {},
) {
  const contract = EXECUTION_QUERY_CONTRACT[commandType];
  if (!contract) return false;
  return contract.requiresExecutionId
    ? Boolean(executionId)
    : Boolean(executionId || rootExecutionId);
}

export const WORKFLOW_NODE_ORIGIN_TYPE = "workflow_node";

export function createWorkflowNodeOrigin({ workflowRunId, nodeExecutionId }) {
  const origin = { type: WORKFLOW_NODE_ORIGIN_TYPE, workflowRunId, nodeExecutionId };
  projectWorkflowNodeOwnership(origin);
  return origin;
}

export function projectWorkflowNodeOwnership(origin) {
  if (!isPlainObject(origin)) {
    throw Object.assign(new TypeError("execution origin must be a plain object"), {
      code: "EXECUTION_ORIGIN_INVALID",
    });
  }
  if (origin.type !== WORKFLOW_NODE_ORIGIN_TYPE) return null;
  const { workflowRunId, nodeExecutionId } = origin;
  if (!isCanonicalText(workflowRunId) || !isCanonicalText(nodeExecutionId)) {
    throw Object.assign(
      new TypeError("workflow node origin requires canonical workflowRunId and nodeExecutionId"),
      { code: "EXECUTION_ORIGIN_INVALID" },
    );
  }
  return { workflowRunId, nodeExecutionId };
}

export function deriveAgentExecutionId({ turnScopeId }) {
  if (!isCanonicalTurnScopeId(turnScopeId)) {
    throw Object.assign(new TypeError("agent execution id requires turnScopeId"), {
      code: "EXECUTION_TURN_SCOPE_REQUIRED",
    });
  }
  return `agent:${turnScopeId}`;
}

export function normalizeExecutionIdentity(source = {}) {
  return Object.freeze({
    executionId: clean(source.executionId),
    executionKind: clean(source.executionKind).toLowerCase(),
    parentExecutionId: clean(source.parentExecutionId),
    rootExecutionId: clean(source.rootExecutionId),
    sessionId: clean(source.sessionId),
    parentSessionId: clean(source.parentSessionId),
    turnScopeId: source.turnScopeId,
    dialogProcessId: clean(source.dialogProcessId),
    stage: clean(source.stage),
    origin: source.origin && typeof source.origin === "object" ? { ...source.origin } : {},
  });
}

function collectAgentExecutionIdErrors(identity, requireSession) {
  if (identity.executionKind !== EXECUTION_KIND.AGENT) return [];
  if (requireSession && !identity.sessionId) return ["missing_session_id"];
  if (!isCanonicalTurnScopeId(identity.turnScopeId)) return ["missing_turn_scope_id"];
  return identity.executionId === deriveAgentExecutionId(identity)
    ? []
    : ["agent_execution_id_not_derived"];
}

export function validateExecutionIdentity(source = {}, { requireSession = true } = {}) {
  const identity = normalizeExecutionIdentity(source);
  const errors = [];
  if (!identity.executionId) errors.push("missing_execution_id");
  if (!Object.values(EXECUTION_KIND).includes(identity.executionKind))
    errors.push("invalid_execution_kind");
  if (!identity.rootExecutionId) errors.push("missing_root_execution_id");
  if (!identity.parentExecutionId && identity.rootExecutionId !== identity.executionId)
    errors.push("root_execution_id_mismatch");
  if (identity.parentExecutionId && identity.parentExecutionId === identity.executionId)
    errors.push("self_parent_execution");
  if (identity.executionId) errors.push(...collectAgentExecutionIdErrors(identity, requireSession));
  return { valid: errors.length === 0, errors, identity };
}

const isExecutionVersion = (value) => Number.isInteger(value) && value >= 1;

export function validateExecutionRecord(source) {
  const validation = validateExecutionIdentity(source);
  const errors = [...validation.errors];
  if (!isExecutionVersion(source.revision)) errors.push("invalid_execution_revision");
  if (!isExecutionVersion(source.sequence)) errors.push("invalid_execution_sequence");
  return { valid: errors.length === 0, errors, identity: validation.identity };
}

export function projectExecutionRecord(turn) {
  return {
    ...normalizeExecutionIdentity(turn),
    state: clean(turn.state),
    executionState: normalizeTurnExecutionState(turn.executionState),
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
    revision: turn.revision,
    sequence: turn.sequence,
  };
}

export function compareExecutionVersion(left, right) {
  return left.revision - right.revision || left.sequence - right.sequence;
}

export function buildExecutionForest(executions) {
  if (!Array.isArray(executions)) {
    throw new TypeError("execution directory must be an array");
  }
  const byId = new Map();
  for (const source of executions) {
    if (
      !isPlainObject(source) ||
      !isCanonicalText(source.executionId) ||
      !(source.parentExecutionId === "" || isCanonicalText(source.parentExecutionId))
    ) {
      throw new TypeError(
        "execution directory requires canonical executionId and parentExecutionId",
      );
    }
    if (byId.has(source.executionId)) {
      throw new TypeError("execution directory contains a duplicate executionId");
    }
    byId.set(source.executionId, { ...source, childExecutionIds: [] });
  }
  const roots = [];
  for (const execution of byId.values()) {
    const parent = byId.get(execution.parentExecutionId);
    if (parent) parent.childExecutionIds.push(execution.executionId);
    else roots.push(execution.executionId);
  }
  const reachable = [...roots];
  for (let index = 0; index < reachable.length; index += 1) {
    reachable.push(...byId.get(reachable[index]).childExecutionIds);
  }
  if (reachable.length !== byId.size) {
    throw new TypeError("execution directory contains a parent cycle");
  }
  return { executions: Object.fromEntries(byId), rootExecutionIds: roots };
}

export function selectExecutionRelations(executions, executionId, { descendants = false } = {}) {
  if (!isCanonicalText(executionId)) {
    throw new TypeError("execution relation query requires a canonical executionId");
  }
  if (!isPlainObject(executions)) {
    throw new TypeError("execution relation query requires an execution directory");
  }
  for (const [key, execution] of Object.entries(executions)) {
    if (!isPlainObject(execution) || key !== execution.executionId) {
      throw new TypeError("execution directory key must match executionId");
    }
  }
  const forest = buildExecutionForest(Object.values(executions));
  if (!Object.hasOwn(forest.executions, executionId)) return [];
  const ids = [...forest.executions[executionId].childExecutionIds];
  if (descendants) {
    for (let index = 0; index < ids.length; index += 1) {
      ids.push(...forest.executions[ids[index]].childExecutionIds);
    }
  }
  return ids.map((id) => executions[id]);
}

export function buildExecutionTree(executions) {
  if (!Array.isArray(executions)) {
    throw new TypeError("execution tree requires an array");
  }
  const records = executions.map((source) => {
    const validation = validateExecutionRecord(source);
    if (!validation.valid) {
      throw Object.assign(new TypeError("execution tree requires valid execution records"), {
        code: "EXECUTION_RECORD_INVALID",
        executionId: validation.identity.executionId,
        errors: validation.errors,
      });
    }
    return {
      ...source,
      ...validation.identity,
    };
  });
  return buildExecutionForest(records);
}
