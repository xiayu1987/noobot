/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compareWorkflowRuntimeFacts, normalizeWorkflowRuntimeEvent, WORKFLOW_RUNTIME_EVENT, WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/shared/workflow-runtime-event-protocol";
import { logWorkflowDiagnostics } from "../../composables/chat/debug/workflowDiagnosticsLogger.js";

const text = (value) => String(value || "").trim();
const TERMINAL = new Set(["completed","succeeded","failed","cancelled","canceled","stopped","aborted","error","expired","timeout","no_conversation"]);
const isSubSessionTerminalStatus = (value) => TERMINAL.has(text(value).toLowerCase());
function projectSubSessionTurnState(currentSession = {}, eventData = {}) {
  const turnScopeId=text(eventData.turnScopeId);
  if (!turnScopeId) return { turnStatuses: currentSession.turnStatuses || [], turnTimings: currentSession.turnTimings || [] };
  const timestamp=eventData.timestamp || eventData.updatedAt || eventData.createdAt || new Date().toISOString();
  const dialogProcessId=text(eventData.dialogProcessId); const status=text(eventData.status || eventData.state).toLowerCase();
  const turnStatuses=[...(currentSession.turnStatuses || [])]; let i=turnStatuses.findIndex(x=>text(x.turnScopeId)===turnScopeId); const old=i>=0?turnStatuses[i]:{};
  const next={...old,turnScopeId,dialogProcessId:dialogProcessId||old.dialogProcessId||"",status:status||old.status||"sending",updatedAt:timestamp}; i>=0?turnStatuses[i]=next:turnStatuses.push(next);
  const turnTimings=[...(currentSession.turnTimings || [])]; i=turnTimings.findIndex(x=>text(x.turnScopeId)===turnScopeId); const timing=i>=0?turnTimings[i]:{};
  const nextTiming={...timing,turnScopeId,dialogProcessId:dialogProcessId||timing.dialogProcessId||"",thinkingStartedAt:timing.thinkingStartedAt||timestamp,thinkingFinishedAt:isSubSessionTerminalStatus(status)?(timing.thinkingFinishedAt||timestamp):null}; i>=0?turnTimings[i]=nextTiming:turnTimings.push(nextTiming);
  return {turnStatuses,turnTimings};
}
function shouldApplyWorkflowNodeStateEvent(current,incoming){ if(!current)return true; const c=compareWorkflowRuntimeFacts(incoming,current,{defaultDomain:WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE}); if(!c.comparable)return false; if(c.order!==0)return c.order>0; return text(incoming.eventId)===text(current.eventId); }
export function createWorkflowNodeStateRegistry(){ return {workflows:{},viewerStates:{}}; }
export function createWorkflowStore({ workflowNodeStateRegistry, subSessionMessageRegistry, upsertSubSessionEvent }) {
function upsertWorkflowNodeStateEvent(eventData = {}) {
  const workflowRunId = text(eventData?.workflowRunId);
  const nodeExecutionId = text(eventData?.nodeExecutionId);
  const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE) {
    return { applied: false, reason: "sequence_domain_mismatch" };
  }
  if (!workflowRunId || !nodeExecutionId) {
    const result = { applied: false, reason: "missing_identity" };
    logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", {
      sessionId: text(eventData?.parentSessionId || eventData?.sessionId),
      nodeSessionId: text(eventData?.sessionId),
      parentSessionId: text(eventData?.parentSessionId),
      dialogProcessId: text(eventData?.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId),
      workflowRunId,
      nodeExecutionId,
      reason: result.reason,
      dataKeys: Object.keys(eventData || {}).sort(),
    });
    return result;
  }
  const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
  if (!registry.workflows) registry.workflows = {};
  if (!registry.workflows[workflowRunId]) registry.workflows[workflowRunId] = { workflowRunId, nodes: {}, sequence: 0 };
  const workflow = registry.workflows[workflowRunId];
  if (!workflow.nodes) workflow.nodes = {};
  const current = workflow.nodes[nodeExecutionId] || null;
  if (!shouldApplyWorkflowNodeStateEvent(current, eventData)) {
    const result = { applied: false, reason: "stale", current };
    logWorkflowDiagnostics("frontend.workflowStore.nodeStateRejected", {
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
    });
    return result;
  }
  const next = {
    ...(current || {}),
    ...(eventData || {}),
    workflowRunId,
    nodeExecutionId,
    commandId: text(eventData?.commandId || current?.commandId),
    sessionId: text(eventData?.sessionId || current?.sessionId),
    parentSessionId: text(eventData?.parentSessionId || current?.parentSessionId),
    dialogProcessId: text(eventData?.dialogProcessId || current?.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId || current?.turnScopeId),
    status: text(eventData?.status || current?.status),
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
    const subRegistry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    if (!subRegistry.sessions) subRegistry.sessions = {};
    const currentSubSession = subRegistry.sessions[childSessionId] || {
      id: childSessionId,
      sessionId: childSessionId,
      messages: [],
      eventsById: {},
      sequence: 0,
    };
    const turnState = projectSubSessionTurnState(currentSubSession, {
      ...next,
      sessionId: childSessionId,
      state: next.status,
    });
    subRegistry.sessions[childSessionId] = {
      ...currentSubSession,
      id: childSessionId,
      sessionId: childSessionId,
      parentSessionId: text(next.parentSessionId || currentSubSession.parentSessionId),
      dialogProcessId: text(next.dialogProcessId || currentSubSession.dialogProcessId),
      turnScopeId: text(next.turnScopeId || currentSubSession.turnScopeId),
      workflowRunId,
      nodeExecutionId,
      status: text(next.status || currentSubSession.status),
      turnStatuses: turnState.turnStatuses,
      turnTimings: turnState.turnTimings,
      sequenceByDomain: {
        ...(currentSubSession.sequenceByDomain || {}),
        [WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE]: Math.max(
          Number(currentSubSession.sequenceByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE] || 0),
          Number(next.sequence || 0),
        ),
      },
      revisionByDomain: {
        ...(currentSubSession.revisionByDomain || {}),
        [WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE]: Math.max(
          Number(currentSubSession.revisionByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE] || 0),
          Number(next.revision || 0),
        ),
      },
      updatedAt: next.updatedAt || new Date().toISOString(),
    };
    subSessionMessageRegistry.value = { ...subRegistry, sessions: { ...subRegistry.sessions } };
    logWorkflowDiagnostics("frontend.workflowStore.nodeSessionStatusApplied", {
      sessionId: childSessionId,
      parentSessionId: next.parentSessionId,
      dialogProcessId: next.dialogProcessId,
      turnScopeId: next.turnScopeId,
      workflowRunId,
      nodeExecutionId,
      status: next.status,
      terminal: isSubSessionTerminalStatus(next.status),
      messageCount: currentSubSession.messages.length,
    });
  }
  logWorkflowDiagnostics("frontend.workflowStore.nodeStateApplied", {
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
  });
  return { applied: true, node: next };
}

function upsertWorkflowPlanningEvent(eventData = {}) {
  const workflowRunId = text(eventData?.workflowRunId);
  const nodeSessions = Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions : [];
  const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.PLANNING;
  if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.PLANNING) {
    return { applied: false, reason: "sequence_domain_mismatch" };
  }
  if (!workflowRunId || !nodeSessions.length) {
    const result = { applied: false, reason: "missing_planning_nodes" };
    logWorkflowDiagnostics("frontend.workflowStore.planningRejected", {
      sessionId: text(eventData?.sessionId),
      dialogProcessId: text(eventData?.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId),
      workflowRunId,
      nodeSessionCount: nodeSessions.length,
      reason: result.reason,
      dataKeys: Object.keys(eventData || {}).sort(),
    });
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
    semanticText: text(eventData?.semanticText || currentWorkflow.semanticText),
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
    stepStatus: text(nodeSession?.stepStatus || nodeSession?.status),
    revision: Number(nodeSession?.revision || 1),
    sequence: Number(nodeSession?.sequence || index + 1),
    eventId: text(nodeSession?.eventId) || `workflow-plan:${text(nodeSession?.nodeExecutionId)}`,
    sequenceDomain: text(nodeSession?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
  }));
  const result = {
    applied: results.some((result) => result?.applied === true),
    results,
  };
  logWorkflowDiagnostics("frontend.workflowStore.planningApplied", {
    sessionId: text(eventData?.sessionId),
    dialogProcessId: text(eventData?.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId),
    workflowRunId,
    nodeSessionCount: nodeSessions.length,
    appliedNodeCount: results.filter((item) => item?.applied === true).length,
    applied: result.applied,
    workflowCount: Object.keys(registry.workflows).length,
  });
  return result;
}

function applyWorkflowRuntimeEvent(record = {}, { source = "unknown" } = {}) {
  const canonical = normalizeWorkflowRuntimeEvent(record, { source });
  if (!canonical.valid) {
    const result = { applied: false, reason: canonical.errors[0] || "invalid_runtime_event", canonical };
    logWorkflowDiagnostics("frontend.workflowStore.runtimeEventRejected", {
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
    });
    return result;
  }
  let result;
  if (canonical.event === WORKFLOW_RUNTIME_EVENT.PLANNING) {
    result = upsertWorkflowPlanningEvent(canonical.data);
  } else if (canonical.event === WORKFLOW_RUNTIME_EVENT.NODE_STATE) {
    result = upsertWorkflowNodeStateEvent(canonical.data);
  } else if (canonical.event === WORKFLOW_RUNTIME_EVENT.MESSAGE) {
    result = upsertSubSessionEvent(canonical.data.eventType, canonical.data);
  } else {
    result = { applied: false, reason: "unsupported_event" };
  }
  logWorkflowDiagnostics("frontend.workflowStore.runtimeEventReduced", {
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
  });
  return { ...(result || {}), canonical };
}
  return { upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent, applyWorkflowRuntimeEvent };
}
