/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/event-protocol/workflow-runtime-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  buildNextWorkflowNodeFact,
  buildPlannedNodeStateEvent,
  buildWorkflowPlanningHeader,
  evaluateWorkflowNodeStateGate,
  resolvePlanningPayload,
} from "./workflowNodeStateProjection.js";

const text = (value) => String(value || "").trim();

export function createWorkflowNodeStateRegistry() {
  return { workflows: {}, viewerStates: {} };
}

export function createWorkflowEventOperations({
  workflowNodeStateRegistry,
  ensureSubSessionMessageContainer,
}) {
  function upsertWorkflowNodeStateEvent(eventData = {}) {
    const workflowRunId = text(eventData?.workflowRunId);
    const nodeExecutionId = text(eventData?.nodeExecutionId);
    const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
    if (!workflowRunId || !nodeExecutionId) {
      const result = { applied: false, reason: "missing_identity" };
      logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", () => ({
        sessionId: text(eventData?.authoritySessionId),
        nodeSessionId: text(eventData?.nodeSessionId),
        dialogProcessId: text(eventData?.dialogProcessId),
        turnScopeId: text(eventData?.turnScopeId),
        workflowRunId,
        nodeExecutionId,
        reason: result.reason,
        dataKeys: Object.keys(eventData || {}).sort(),
      }));
      return result;
    }
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    if (!registry.workflows) registry.workflows = {};
    if (!registry.workflows[workflowRunId])
      registry.workflows[workflowRunId] = { workflowRunId, nodes: {}, sequence: 0 };
    const workflow = registry.workflows[workflowRunId];
    if (!workflow.nodes) workflow.nodes = {};
    const current = workflow.nodes[nodeExecutionId] || null;
    const gate = evaluateWorkflowNodeStateGate({ eventData, current, sequenceDomain });
    if (!gate.admitted) {
      if (gate.logStale) {
        logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", () => ({
          sessionId: text(eventData?.authoritySessionId),
          nodeSessionId: text(eventData?.nodeSessionId || current?.nodeSessionId),
          dialogProcessId: text(eventData?.dialogProcessId),
          turnScopeId: text(eventData?.turnScopeId),
          workflowRunId,
          nodeExecutionId,
          reason: gate.result.reason,
          incomingRevision: Number(eventData?.revision || 0),
          currentRevision: Number(current?.revision || 0),
        }));
      }
      return gate.result;
    }
    const next = buildNextWorkflowNodeFact({
      eventData,
      current,
      workflowRunId,
      nodeExecutionId,
      sequenceDomain,
    });
    workflow.nodes[nodeExecutionId] = next;
    workflow.sequence = Math.max(Number(workflow.sequence || 0), Number(next.sequence || 0));
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    const childSessionId = text(next.nodeSessionId);
    if (childSessionId) {
      ensureSubSessionMessageContainer({
        sessionId: childSessionId,
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

  function upsertWorkflowPlanningEvent(eventData = {}) {
    const workflowRunId = text(eventData?.workflowRunId);
    const nodeSessions = Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions : [];
    const workflowPayload = resolvePlanningPayload(eventData);
    const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
    if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.PLANNING) {
      return { applied: false, reason: "sequence_domain_mismatch" };
    }
    if (!workflowRunId || !nodeSessions.length || !workflowPayload) {
      const result = { applied: false, reason: "missing_planning_payload" };
      logWorkflowDiagnostics("frontend.workflowStore.planningRejected", () => ({
        sessionId: text(eventData?.authoritySessionId),
        dialogProcessId: text(eventData?.dialogProcessId),
        turnScopeId: text(eventData?.turnScopeId),
        workflowRunId,
        nodeSessionCount: nodeSessions.length,
        hasWorkflowPayload: Boolean(workflowPayload),
        reason: result.reason,
        dataKeys: Object.keys(eventData || {}).sort(),
      }));
      return result;
    }
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    registry.workflows = registry.workflows || {};
    const currentWorkflow = registry.workflows[workflowRunId] || {
      workflowRunId,
      nodes: {},
      sequence: 0,
    };
    registry.workflows[workflowRunId] = buildWorkflowPlanningHeader({
      currentWorkflow,
      eventData,
      workflowRunId,
      workflowPayload,
    });
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    const results = nodeSessions.map((nodeSession = {}, index) =>
      upsertWorkflowNodeStateEvent(
        buildPlannedNodeStateEvent({ nodeSession, eventData, workflowRunId, index }),
      ),
    );
    const result = {
      applied: results.some((result) => result?.applied === true),
      results,
    };
    logWorkflowDiagnostics("frontend.workflowStore.planningApplied", () => ({
      sessionId: text(eventData?.authoritySessionId),
      dialogProcessId: text(eventData?.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId),
      workflowRunId,
      nodeSessionCount: nodeSessions.length,
      appliedNodeCount: results.filter((item) => item?.applied === true).length,
      semanticNodeCount: Array.isArray(workflowPayload?.semantic?.nodes)
        ? workflowPayload.semantic.nodes.length
        : 0,
      semanticFlowtoCount: Array.isArray(workflowPayload?.semantic?.flowtos)
        ? workflowPayload.semantic.flowtos.length
        : 0,
      applied: result.applied,
      workflowCount: Object.keys(registry.workflows).length,
    }));
    return result;
  }

  return { upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent };
}
