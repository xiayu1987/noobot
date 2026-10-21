/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createWorkflowNodeDialogProcessId,
  createWorkflowNodeTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { deriveAgentExecutionId, deriveTurnCommandId } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

function safeId(value = "") {
  return text(value).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

const WORKFLOW_RUN_IDENTITY_FIELDS = Object.freeze([
  "turnScopeId",
  "commandId",
  "executionId",
  "rootExecutionId",
  "presentationMessageId",
]);

export function resolveWorkflowRunIdentity(ctx = {}) {
  const runConfig = ctx?.runConfig;
  const identity = {};
  for (const field of WORKFLOW_RUN_IDENTITY_FIELDS) {
    const value = text(runConfig?.[field]);
    if (!value) throw new TypeError(`workflow runConfig.${field} is required`);
    identity[field] = value;
  }
  return { ...identity, workflowRunId: identity.executionId };
}

export function createWorkflowNodeIdentity({ workflowRunId = "", node = {}, attempt = 1 } = {}) {
  const runId = text(workflowRunId);
  if (!runId) throw new TypeError("workflow run id is required");
  const nodeId = text(node?.id);
  if (!nodeId) throw new TypeError("workflow node id is required");
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError("workflow node attempt must be a positive integer");
  }
  const nodeExecutionId = `${safeId(runId)}_${safeId(nodeId)}_${attempt}`;
  const dialogProcessId = createWorkflowNodeDialogProcessId(nodeExecutionId);
  const turnScopeId = createWorkflowNodeTurnScopeId(nodeExecutionId);
  return {
    workflowRunId: runId,
    nodeExecutionId,
    nodeId,
    attempt,
    dialogProcessId,
    turnScopeId,
    activeChildExecutionId: deriveAgentExecutionId({ turnScopeId }),
    commandId: deriveTurnCommandId(turnScopeId),
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
