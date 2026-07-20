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
    ctx?.runConfig?.workflowRunId || ctx?.runConfig?.workflowInstanceId || "",
  ).trim();
  if (provided) return provided;
  const dialog = safeId(ctx?.dialogProcessId || ctx?.turnScopeId || ctx?.sessionId || "session");
  return `wf_run_${dialog}`;
}

export function createWorkflowNodeIdentity({ workflowRunId = "", node = {}, index = 0, attempt = 1 } = {}) {
  const nodeId = String(node?.id || node?.nodeId || node?.stepId || `node_${index}`).trim();
  const nodeExecutionId = `${safeId(workflowRunId || "workflow")}_${safeId(nodeId)}_${Math.max(1, Number(attempt) || 1)}`;
  const dialogProcessId = `wf_node_${nodeExecutionId}`;
  return {
    workflowRunId: String(workflowRunId || "").trim(),
    nodeExecutionId,
    nodeId,
    attempt: Math.max(1, Number(attempt) || 1),
    dialogProcessId,
    turnScopeId: `workflow-node:${nodeExecutionId}`,
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
