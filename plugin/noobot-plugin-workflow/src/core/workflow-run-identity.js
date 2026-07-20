/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function safeId(value = "") {
  return String(value || "").trim().replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveWorkflowRunId(ctx = {}) {
  const provided = String(
    ctx?.workflowRunId || ctx?.workflowInstanceId ||
    ctx?.runConfig?.workflowRunId || ctx?.runConfig?.workflowInstanceId ||
    ctx?.executionId || ctx?.turnScopeId || ctx?.runConfig?.executionId ||
    ctx?.runConfig?.turnScopeId || "",
  ).trim();
  if (provided) return provided;
  const dialog = safeId(ctx?.dialogProcessId || ctx?.turnScopeId || ctx?.sessionId || "session");
  // dialogProcessId/sessionId identify a conversation, not one workflow run.
  // Reusing them as the run id lets a later turn attach to a terminal node
  // repository snapshot from an earlier turn. Keep a generated id on the
  // dispatch context so every call in this run observes the same identity,
  // while separate turns remain isolated even when they share a dialog.
  const generated = `wf_run_${dialog}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (ctx && typeof ctx === "object") ctx.workflowRunId = generated;
  return generated;
}

export function createWorkflowNodeIdentity({ workflowRunId = "", node = {}, index = 0, attempt = 1 } = {}) {
  const nodeId = String(node?.id || node?.nodeId || node?.stepId || `node_${index}`).trim();
  const nodeExecutionId = `${safeId(workflowRunId || "workflow")}_${safeId(nodeId)}_${Math.max(1, Number(attempt) || 1)}`;
  const dialogProcessId = `wf_node_${nodeExecutionId}`;
  const turnScopeId = `workflow-node:${nodeExecutionId}`;
  return {
    workflowRunId: String(workflowRunId || "").trim(),
    nodeExecutionId,
    nodeId,
    attempt: Math.max(1, Number(attempt) || 1),
    dialogProcessId,
    turnScopeId,
    childExecutionId: `agent:${turnScopeId}`,
    commandId: `workflow-node:${nodeExecutionId}:send`,
  };
}

export function buildWorkflowPlanningNodeSessions({ workflowRunId = "", semantic = {} } = {}) {
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const flowtos = Array.isArray(semantic?.flowtos) ? semantic.flowtos : [];
  const nodeById = new Map(nodes.map((node = {}) => [String(node?.id || "").trim(), node]));
  const now = new Date().toISOString();
  return nodes.map((node = {}, index) => {
    const identity = createWorkflowNodeIdentity({ workflowRunId, node, index });
    const nodeType = String(node?.type || "").trim().toLowerCase();
    const executable = nodeType === "action";
    const dependencies = flowtos
      .filter((edge = {}) => String(edge?.to || "").trim() === identity.nodeId)
      .map((edge = {}) => String(edge?.from || "").trim())
      .filter((dependencyId) => nodeById.get(dependencyId)?.type === "action");
    return {
      ...identity,
      nodeName: String(node?.name || identity.nodeId).trim(),
      nodeType: node?.type ?? "",
      dependencies,
      stepStatus: executable ? (dependencies.length ? "pending" : "ready") : "pending",
      revision: 1,
      sequence: index + 1,
      eventId: `workflow-plan:${identity.nodeExecutionId}`,
      updatedAt: now,
      sessionId: "",
    };
  });
}
