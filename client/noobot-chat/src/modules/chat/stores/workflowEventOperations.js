/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  buildPlannedNodeStateEvent,
  buildWorkflowPlanningHeader,
  evaluateWorkflowNodeStateGate,
} from "./workflowNodeStateProjection.js";

export function createWorkflowNodeStateRegistry() {
  return { workflows: {}, viewerStates: {} };
}

function createWorkflowEntry(workflowRunId) {
  return { workflowRunId, nodes: {}, sequence: 0 };
}

export function createWorkflowEventOperations({
  workflowNodeStateRegistry,
  ensureSubSessionMessageContainer,
}) {
  function upsertWorkflowNodeStateEvent(eventData) {
    const { workflowRunId, nodeExecutionId } = eventData;
    const registry = workflowNodeStateRegistry.value;
    if (!registry.workflows[workflowRunId]) {
      registry.workflows[workflowRunId] = createWorkflowEntry(workflowRunId);
    }
    const workflow = registry.workflows[workflowRunId];
    const current = workflow.nodes[nodeExecutionId] || null;
    const gate = evaluateWorkflowNodeStateGate({ eventData, current });
    if (!gate.admitted) {
      if (gate.logStale) {
        logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", () => ({
          sessionId: eventData.authoritySessionId,
          nodeSessionId: eventData.nodeSessionId,
          dialogProcessId: eventData.dialogProcessId,
          turnScopeId: eventData.turnScopeId,
          workflowRunId,
          nodeExecutionId,
          reason: gate.result.reason,
          incomingRevision: eventData.revision,
          currentRevision: current?.revision,
        }));
      }
      return gate.result;
    }
    const next = { ...eventData };
    workflow.nodes[nodeExecutionId] = next;
    workflow.sequence = Math.max(workflow.sequence, next.sequence);
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    if (next.nodeSessionId) {
      ensureSubSessionMessageContainer({
        sessionId: next.nodeSessionId,
        parentSessionId: next.authoritySessionId,
        dialogProcessId: next.dialogProcessId,
        turnScopeId: next.turnScopeId,
        workflowRunId,
        nodeExecutionId,
      });
    }
    logWorkflowDiagnostics("frontend.workflowStore.nodeStateApplied", () => ({
      sessionId: next.authoritySessionId,
      nodeSessionId: next.nodeSessionId,
      dialogProcessId: next.dialogProcessId,
      turnScopeId: next.turnScopeId,
      workflowRunId,
      nodeExecutionId,
      status: next.status,
      revision: next.revision,
      sequence: next.sequence,
      workflowCount: Object.keys(registry.workflows).length,
      nodeCount: Object.keys(workflow.nodes).length,
    }));
    return { applied: true, node: next };
  }

  function upsertWorkflowPlanningEvent(eventData) {
    const { workflowRunId, workflowPayload } = eventData;
    const { nodeSessions } = workflowPayload;
    const registry = workflowNodeStateRegistry.value;
    registry.workflows[workflowRunId] = buildWorkflowPlanningHeader({
      currentWorkflow: registry.workflows[workflowRunId] || createWorkflowEntry(workflowRunId),
      eventData,
    });
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    const results = nodeSessions.map((nodeSession) =>
      upsertWorkflowNodeStateEvent(buildPlannedNodeStateEvent({ nodeSession, eventData })),
    );
    const result = {
      applied: results.some((item) => item.applied === true),
      results,
    };
    logWorkflowDiagnostics("frontend.workflowStore.planningApplied", () => ({
      sessionId: eventData.authoritySessionId,
      dialogProcessId: eventData.dialogProcessId,
      turnScopeId: eventData.turnScopeId,
      workflowRunId,
      nodeSessionCount: nodeSessions.length,
      appliedNodeCount: results.filter((item) => item.applied === true).length,
      semanticNodeCount: workflowPayload.semantic?.nodes?.length,
      semanticFlowtoCount: workflowPayload.semantic?.flowtos?.length,
      applied: result.applied,
      workflowCount: Object.keys(registry.workflows).length,
    }));
    return result;
  }

  return { upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent };
}
