/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Execution is the common identity/projection shared by root Agents, child
 * Agents and Workflow runs. Turn remains the compatibility transport for an
 * Agent execution; lifecycle state and transition semantics stay authoritative
 * in the existing Turn state machine.
 */
export const EXECUTION_KIND = Object.freeze({
  AGENT: "agent",
  WORKFLOW: "workflow",
});

export const EXECUTION_LIFECYCLE_WIRE_EVENT = "execution_lifecycle";
export const EXECUTION_TREE_WIRE_EVENT = "execution_tree";
export const EXECUTION_SNAPSHOT_WIRE_EVENT = "execution_snapshot";
export const EXECUTION_CHILDREN_WIRE_EVENT = "execution_children";

export const EXECUTION_QUERY_COMMAND = Object.freeze({
  SNAPSHOT_GET: "execution.snapshot.get",
  CHILDREN_GET: "execution.children.get",
  TREE_GET: "execution.tree.get",
});

const clean = (value) => String(value || "").trim();

export function deriveAgentExecutionId({ executionId = "", turnScopeId = "" } = {}) {
  return clean(executionId) || (clean(turnScopeId) ? `agent:${clean(turnScopeId)}` : "");
}

export function normalizeExecutionIdentity(source = {}) {
  const executionKind = clean(source.executionKind).toLowerCase() || EXECUTION_KIND.AGENT;
  const executionId = executionKind === EXECUTION_KIND.AGENT
    ? deriveAgentExecutionId(source)
    : clean(source.executionId || source.workflowExecutionId || source.workflowRunId);
  const parentExecutionId = clean(source.parentExecutionId);
  return Object.freeze({
    executionId,
    executionKind,
    parentExecutionId,
    rootExecutionId: clean(source.rootExecutionId) || (parentExecutionId ? clean(source.rootExecutionId) : executionId),
    sessionId: clean(source.sessionId),
    parentSessionId: clean(source.parentSessionId),
    turnScopeId: clean(source.turnScopeId),
    dialogProcessId: clean(source.dialogProcessId),
    stage: clean(source.stage),
    origin: source.origin && typeof source.origin === "object" ? { ...source.origin } : {},
  });
}

export function validateExecutionIdentity(source = {}) {
  const identity = normalizeExecutionIdentity(source);
  const errors = [];
  if (!identity.executionId) errors.push("missing_execution_id");
  if (!Object.values(EXECUTION_KIND).includes(identity.executionKind)) errors.push("invalid_execution_kind");
  if (!identity.rootExecutionId) errors.push("missing_root_execution_id");
  if (identity.parentExecutionId && identity.parentExecutionId === identity.executionId) errors.push("self_parent_execution");
  if (identity.executionKind === EXECUTION_KIND.AGENT && !identity.sessionId) errors.push("missing_session_id");
  return { valid: errors.length === 0, errors, identity };
}

export function createExecutionLifecycleEnvelope(source = {}) {
  const identity = normalizeExecutionIdentity(source);
  return {
    protocolVersion: Number(source.protocolVersion || 1),
    eventType: clean(source.eventType),
    eventId: clean(source.eventId),
    commandId: clean(source.commandId),
    causationId: clean(source.causationId),
    correlationId: clean(source.correlationId),
    ...identity,
    revision: Number(source.revision || 0),
    sequence: Number(source.sequence || 0),
    phase: clean(source.phase),
    state: clean(source.state),
    action: clean(source.action),
    executionState: clean(source.executionState).toLowerCase(),
    capabilities: source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {},
    failure: source.failure && typeof source.failure === "object" ? source.failure : undefined,
    updatedAt: clean(source.updatedAt),
    occurredAt: clean(source.occurredAt),
    payload: source.payload && typeof source.payload === "object" ? source.payload : {},
  };
}

/** Build a read model without creating another writable lifecycle fact. */
export function buildExecutionTree(executions = []) {
  const byId = new Map();
  for (const source of Array.isArray(executions) ? executions : []) {
    const validation = validateExecutionIdentity(source);
    if (!validation.valid) continue;
    byId.set(validation.identity.executionId, { ...source, ...validation.identity, childExecutionIds: [] });
  }
  const roots = [];
  for (const execution of byId.values()) {
    const parent = byId.get(execution.parentExecutionId);
    if (parent) parent.childExecutionIds.push(execution.executionId);
    else roots.push(execution.executionId);
  }
  return { executions: Object.fromEntries(byId), rootExecutionIds: roots };
}
