/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compareWorkflowRuntimeFacts, normalizeWorkflowRuntimeEvent, WORKFLOW_RUNTIME_EVENT, WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/shared/workflow-runtime-event-protocol";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";

const text = (value) => String(value || "").trim();
const WORKFLOW_NODE_TERMINAL_STATUSES = new Set([
  "succeeded", "completed", "failed", "cancelled", "canceled", "stopped",
  "aborted", "error", "expired", "timeout",
]);
function isWorkflowNodeTerminalStatus(value) {
  return WORKFLOW_NODE_TERMINAL_STATUSES.has(text(value).toLowerCase());
}
function shouldApplyWorkflowNodeStateEvent(current,incoming){ if(!current)return true; const c=compareWorkflowRuntimeFacts(incoming,current,{defaultDomain:WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE}); if(!c.comparable)return false; if(c.order!==0)return c.order>0; return text(incoming.eventId)===text(current.eventId); }
export function createWorkflowNodeStateRegistry(){ return {workflows:{},viewerStates:{}}; }
export function createWorkflowStore({ workflowNodeStateRegistry, ensureSubSessionMessageContainer, reduceSubSessionMessageEvent, reduceSubSessionSnapshot, removeSubSessionsByWorkflowRunIds }) {
function selectWorkflowNodeState(sessionId = "", turnScopeId = "") {
  const requestedSessionId = text(sessionId);
  const requestedTurnScopeId = text(turnScopeId);
  if (!requestedSessionId && !requestedTurnScopeId) return null;
  const workflows = workflowNodeStateRegistry.value?.workflows || {};
  const candidates = Object.values(workflows).flatMap((workflow = {}) =>
    Object.values(workflow.nodes || {}),
  ).filter((node = {}) => {
    const nodeSessionId = text(node.sessionId);
    const nodeTurnScopeId = text(node.turnScopeId);
    return (!requestedSessionId || nodeSessionId === requestedSessionId) &&
      (!requestedTurnScopeId || nodeTurnScopeId === requestedTurnScopeId);
  });
  return candidates.sort((left, right) => {
    const sequenceDelta = Number(right.sequence || 0) - Number(left.sequence || 0);
    if (sequenceDelta) return sequenceDelta;
    return Number(right.revision || 0) - Number(left.revision || 0);
  })[0] || null;
}
function upsertWorkflowNodeStateEvent(eventData = {}) {
  const workflowRunId = text(eventData?.workflowRunId);
  const nodeExecutionId = text(eventData?.nodeExecutionId);
  const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE) {
    return { applied: false, reason: "sequence_domain_mismatch" };
  }
  if (!workflowRunId || !nodeExecutionId) {
    const result = { applied: false, reason: "missing_identity" };
    logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", () => ({
      sessionId: text(eventData?.parentSessionId || eventData?.sessionId),
      nodeSessionId: text(eventData?.sessionId),
      parentSessionId: text(eventData?.parentSessionId),
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
  if (!registry.workflows[workflowRunId]) registry.workflows[workflowRunId] = { workflowRunId, nodes: {}, sequence: 0 };
  const workflow = registry.workflows[workflowRunId];
  if (!workflow.nodes) workflow.nodes = {};
  const current = workflow.nodes[nodeExecutionId] || null;
  const currentStatus = text(current?.status).toLowerCase();
  const incomingStatus = text(eventData?.status || eventData?.stepStatus).toLowerCase();
  if (
    current &&
    isWorkflowNodeTerminalStatus(currentStatus) &&
    incomingStatus &&
    incomingStatus !== currentStatus
  ) {
    return { applied: false, reason: "terminal_state_immutable", current };
  }
  if (!shouldApplyWorkflowNodeStateEvent(current, eventData)) {
    const result = { applied: false, reason: "stale", current };
    logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", () => ({
      sessionId: text(eventData?.parentSessionId || eventData?.sessionId),
      nodeSessionId: text(eventData?.sessionId || current?.sessionId),
      parentSessionId: text(eventData?.parentSessionId || current?.parentSessionId),
      dialogProcessId: text(eventData?.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId),
      workflowRunId,
      nodeExecutionId,
      reason: result.reason,
      incomingRevision: Number(eventData?.revision || 0),
      currentRevision: Number(current?.revision || 0),
    }));
    return result;
  }
  const authoritativeStatus = text(eventData?.status || eventData?.stepStatus || current?.status || current?.stepStatus);
  const { stepStatus: _incomingStepStatus, ...incomingFact } = eventData || {};
  const { stepStatus: _currentStepStatus, ...currentFact } = current || {};
  const next = {
    ...currentFact,
    ...incomingFact,
    workflowRunId,
    nodeExecutionId,
    commandId: text(eventData?.commandId || current?.commandId),
    sessionId: text(eventData?.sessionId || current?.sessionId),
    parentSessionId: text(eventData?.parentSessionId || current?.parentSessionId),
    dialogProcessId: text(eventData?.dialogProcessId || current?.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId || current?.turnScopeId),
    status: authoritativeStatus,
    eventId: text(eventData?.eventId || current?.eventId),
    revision: Number(eventData?.revision ?? current?.revision ?? 0),
    sequence: Number(eventData?.sequence ?? current?.sequence ?? 0),
    sequenceDomain,
  };
  workflow.nodes[nodeExecutionId] = next;
  workflow.sequence = Math.max(Number(workflow.sequence || 0), Number(next.sequence || 0));
  workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
  const childSessionId = text(next.sessionId);
  if (childSessionId && childSessionId !== text(next.parentSessionId)) {
    ensureSubSessionMessageContainer({
      sessionId: childSessionId,
      parentSessionId: next.parentSessionId,
      dialogProcessId: next.dialogProcessId,
      turnScopeId: next.turnScopeId,
      workflowRunId,
      nodeExecutionId,
    });
  }
  logWorkflowDiagnostics("frontend.workflowStore.nodeStateApplied", () => ({
    sessionId: text(next.parentSessionId || next.sessionId),
    nodeSessionId: next.sessionId,
    parentSessionId: next.parentSessionId,
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
  const workflowPayload = eventData?.workflowPayload &&
    typeof eventData.workflowPayload === "object" &&
    !Array.isArray(eventData.workflowPayload)
    ? eventData.workflowPayload
    : null;
  const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
  if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.PLANNING) {
    return { applied: false, reason: "sequence_domain_mismatch" };
  }
  if (!workflowRunId || !nodeSessions.length || !workflowPayload) {
    const result = { applied: false, reason: "missing_planning_payload" };
    logWorkflowDiagnostics("frontend.workflowStore.planningRejected", () => ({
      sessionId: text(eventData?.sessionId),
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
  const currentWorkflow = registry.workflows[workflowRunId] || { workflowRunId, nodes: {}, sequence: 0 };
  registry.workflows[workflowRunId] = {
    ...currentWorkflow,
    workflowRunId,
    sessionId: text(currentWorkflow.sessionId || eventData?.sessionId),
    dialogProcessId: text(currentWorkflow.dialogProcessId || eventData?.dialogProcessId),
    turnScopeId: text(currentWorkflow.turnScopeId || eventData?.turnScopeId),
    presentationMessageId: text(
      currentWorkflow.presentationMessageId || eventData?.presentationMessageId,
    ),
    semanticText: text(eventData?.semanticText || currentWorkflow.semanticText),
    workflowPayload,
    plannedAt: eventData?.createdAt || currentWorkflow.plannedAt || new Date().toISOString(),
  };
  workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
  const results = nodeSessions.map((nodeSession = {}, index) => upsertWorkflowNodeStateEvent({
    ...(nodeSession || {}),
    sessionId: text(nodeSession?.sessionId || nodeSession?.nodeSessionId),
    parentSessionId: text(nodeSession?.parentSessionId || eventData?.sessionId),
    workflowRunId: text(nodeSession?.workflowRunId) || workflowRunId,
    nodeExecutionId: text(nodeSession?.nodeExecutionId),
    status: text(nodeSession?.status || nodeSession?.stepStatus),
    revision: Number(nodeSession?.revision || 1),
    sequence: Number(nodeSession?.sequence || index + 1),
    eventId: text(nodeSession?.eventId) || `workflow-plan:${text(nodeSession?.nodeExecutionId)}`,
    sequenceDomain: text(nodeSession?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
  }));
  const result = {
    applied: results.some((result) => result?.applied === true),
    results,
  };
  logWorkflowDiagnostics("frontend.workflowStore.planningApplied", () => ({
    sessionId: text(eventData?.sessionId),
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

  function applyWorkflowRuntimeEvent(record = {}, { source = "unknown" } = {}) {
  const canonical = normalizeWorkflowRuntimeEvent(record, { source });
  if (!canonical.valid) {
    const result = { applied: false, reason: canonical.errors[0] || "invalid_runtime_event", canonical };
    logWorkflowDiagnostics("frontend.workflowStore.runtimeEventRejected", () => ({
      sessionId: text(canonical?.data?.parentSessionId || canonical?.data?.sessionId),
      dialogProcessId: text(canonical?.data?.dialogProcessId),
      turnScopeId: text(canonical?.data?.turnScopeId),
      workflowRunId: text(canonical?.data?.workflowRunId),
      nodeExecutionId: text(canonical?.data?.nodeExecutionId),
      source: canonical.source,
      runtimeEvent: canonical.event,
      sequenceDomain: canonical.sequenceDomain,
      authoritativeSequence: canonical.sequence,
      transportSequence: canonical.transportSequence,
      reason: result.reason,
    }));
    return result;
  }
  let result;
  if (canonical.event === WORKFLOW_RUNTIME_EVENT.PLANNING) {
    result = upsertWorkflowPlanningEvent(canonical.data);
  } else if (canonical.event === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
    result = upsertWorkflowNodeStateEvent(canonical.data);
  } else if (canonical.event === WORKFLOW_RUNTIME_EVENT.MESSAGE) {
    result = reduceSubSessionMessageEvent(canonical.data.eventType, canonical.data);
  } else if (canonical.event === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
    result = reduceSubSessionSnapshot(canonical.data, {
      source: canonical.source,
      eventId: canonical.eventId,
      sequenceDomain: canonical.sequenceDomain,
      authoritativeSequence: canonical.sequence,
      transportSequence: canonical.transportSequence,
    });
  } else {
    result = { applied: false, reason: "unsupported_event" };
  }
  logWorkflowDiagnostics("frontend.workflowStore.runtimeEventReduced", () => ({
    sessionId: text(canonical?.data?.parentSessionId || canonical?.data?.sessionId),
    dialogProcessId: text(canonical?.data?.dialogProcessId),
    turnScopeId: text(canonical?.data?.turnScopeId),
    workflowRunId: text(canonical?.data?.workflowRunId),
    nodeExecutionId: text(canonical?.data?.nodeExecutionId),
    source: canonical.source,
    runtimeEvent: canonical.event,
    sequenceDomain: canonical.sequenceDomain,
    authoritativeSequence: canonical.sequence,
    transportSequence: canonical.transportSequence,
    applied: result?.applied === true,
    reason: text(result?.reason),
  }));
  return { ...(result || {}), canonical };
  }
  function removeWorkflowOwnersForReplacedTurns({ parentSessionId = "", replacedTurnScopeIds = [] } = {}) {
    const expectedParentSessionId = text(parentSessionId);
    const replacedScopes = new Set(
      (Array.isArray(replacedTurnScopeIds) ? replacedTurnScopeIds : []).map(text).filter(Boolean),
    );
    if (!expectedParentSessionId || !replacedScopes.size) {
      return { removedWorkflowRunIds: [], removedSessionIds: [] };
    }
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    const workflows = { ...(registry.workflows || {}) };
    const removedWorkflowRunIds = [];
    for (const [workflowRunId, workflow = {}] of Object.entries(workflows)) {
      const ownsParent = text(workflow.sessionId) === expectedParentSessionId ||
        Object.values(workflow.nodes || {}).some((node = {}) => text(node.parentSessionId) === expectedParentSessionId);
      if (!ownsParent) continue;
      const ownsReplacedTurn = replacedScopes.has(text(workflow.turnScopeId));
      if (!ownsReplacedTurn) continue;
      delete workflows[workflowRunId];
      removedWorkflowRunIds.push(workflowRunId);
    }
    if (removedWorkflowRunIds.length) {
      workflowNodeStateRegistry.value = { ...registry, workflows };
    }
    const subSessionResult = removeSubSessionsByWorkflowRunIds?.(
      removedWorkflowRunIds,
      { parentSessionId: expectedParentSessionId },
    ) || { removedSessionIds: [] };
    logWorkflowDiagnostics("frontend.workflowStore.replacedOwnersRemoved", () => ({
      sessionId: expectedParentSessionId,
      replacedTurnScopeIds: [...replacedScopes],
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds || [],
    }));
    return {
      removedWorkflowRunIds,
      removedSessionIds: subSessionResult.removedSessionIds || [],
    };
  }
  return { applyWorkflowRuntimeEvent, removeWorkflowOwnersForReplacedTurns, selectWorkflowNodeState };
}
