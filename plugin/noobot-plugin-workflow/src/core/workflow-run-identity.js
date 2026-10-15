/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { deriveAgentExecutionId } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

function safeId(value = "") {
  return text(value).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveWorkflowRunId(ctx = {}) {
  const provided = text(
    ctx?.workflowRunId ||
      ctx?.workflowInstanceId ||
      ctx?.runConfig?.workflowRunId ||
      ctx?.runConfig?.workflowInstanceId ||
      ctx?.executionId ||
      ctx?.turnScopeId ||
      ctx?.runConfig?.executionId ||
      ctx?.runConfig?.turnScopeId,
  );
  if (provided) return provided;
  const dialog = safeId(ctx?.dialogProcessId || ctx?.turnScopeId || ctx?.sessionId || "session");
  const generated = `wf_run_${dialog}_${randomUUID()}`;
  if (ctx && typeof ctx === "object") ctx.workflowRunId = generated;
  return generated;
}

export function createWorkflowNodeIdentity({ workflowRunId = "", node = {}, attempt = 1 } = {}) {
  const nodeId = text(node?.id);
  if (!nodeId) throw new TypeError("workflow node id is required");
  const nodeExecutionId = `${safeId(workflowRunId || "workflow")}_${safeId(nodeId)}_${Math.max(1, Number(attempt) || 1)}`;
  const dialogProcessId = createWorkflowNodeDialogProcessId(nodeExecutionId);
  const turnScopeId = createWorkflowNodeTurnScopeId(nodeExecutionId);
  return {
    workflowRunId: text(workflowRunId),
    nodeExecutionId,
    nodeId,
    attempt: Math.max(1, Number(attempt) || 1),
    dialogProcessId,
    turnScopeId,
    activeChildExecutionId: deriveAgentExecutionId({ turnScopeId }),
    commandId: `workflow-node:${nodeExecutionId}:send`,
  };
}

export function buildWorkflowPlanningNodeSessions({ workflowRunId = "", semantic = {} } = {}) {
  const nodes = Array.isArray(semantic?.nodes) ? semantic.nodes : [];
  const flowtos = Array.isArray(semantic?.flowtos) ? semantic.flowtos : [];
  const nodeById = new Map(nodes.map((node = {}) => [text(node?.id), node]));
  const now = new Date().toISOString();
  return nodes.map((node = {}, index) => {
    const identity = createWorkflowNodeIdentity({ workflowRunId, node });
    const nodeType = text(node?.type).toLowerCase();
    const executable = nodeType === "action";
    const dependencies = flowtos
      .filter((edge = {}) => text(edge?.to) === identity.nodeId)
      .map((edge = {}) => text(edge?.from))
      .filter((dependencyId) => nodeById.get(dependencyId)?.type === "action");
    return {
      ...identity,
      nodeName: text(node?.name),
      nodeType: node?.type ?? "",
      dependencies,
      status: executable ? (dependencies.length ? "pending" : "ready") : "pending",
      revision: 1,
      sequence: index + 1,
      eventId: `workflow-plan:${identity.nodeExecutionId}`,
      updatedAt: now,
      nodeSessionId: "",
    };
  });
}
