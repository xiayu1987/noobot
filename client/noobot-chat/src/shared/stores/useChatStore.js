/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  createTurnRuntimeRegistryState,
  selectExecution,
  selectExecutionChildren,
  sessionRuntimeId,
} from "../../composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

function text(value) {
  return String(value || "").trim();
}

function createWorkflowNodeStateRegistry() {
  return { workflows: {} };
}

function createSubSessionMessageRegistry() {
  return { sessions: {} };
}

function shouldApplyWorkflowNodeStateEvent(current = null, incoming = {}) {
  if (!current) return true;
  const incomingRevision = Number(incoming?.revision || 0);
  const currentRevision = Number(current?.revision || 0);
  if (incomingRevision < currentRevision) return false;
  if (incomingRevision > currentRevision) return true;
  const incomingSequence = Number(incoming?.sequence || 0);
  const currentSequence = Number(current?.sequence || 0);
  if (incomingSequence < currentSequence) return false;
  if (incomingSequence > currentSequence) return true;
  return text(incoming?.eventId) === text(current?.eventId);
}

function shouldApplyOrderedEvent(current = null, incoming = {}) {
  if (!current) return true;
  const incomingRevision = Number(incoming?.revision || 0);
  const currentRevision = Number(current?.revision || 0);
  if (incomingRevision < currentRevision) return false;
  if (incomingRevision > currentRevision) return true;
  const incomingSequence = Number(incoming?.sequence || incoming?.seq || 0);
  const currentSequence = Number(current?.sequence || current?.seq || 0);
  if (incomingSequence < currentSequence) return false;
  if (incomingSequence > currentSequence) return true;
  const incomingEventId = text(incoming?.eventId || incoming?.id);
  const currentEventId = text(current?.eventId || current?.id);
  if (!incomingEventId || !currentEventId) return true;
  return incomingEventId === currentEventId;
}

function eventContent(eventData = {}) {
  return String(eventData?.content ?? eventData?.delta ?? eventData?.message ?? eventData?.text ?? "");
}

function normalizeSubSessionMessage(eventName = "", eventData = {}, currentMessage = null) {
  const content = eventContent(eventData);
  const role = text(eventData?.role) || (String(eventName).includes("user") ? "user" : "assistant");
  const eventId = text(eventData?.eventId || eventData?.id) || `${text(eventData?.turnScopeId)}:${text(eventData?.seq || eventData?.sequence)}:${eventName}`;
  const appendDelta = Boolean(eventData?.delta) || String(eventName).includes("delta");
  const previousContent = String(currentMessage?.content || "");
  return {
    ...(currentMessage || {}),
    ...(eventData?.message && typeof eventData.message === "object" ? eventData.message : {}),
    id: text(currentMessage?.id || eventData?.messageId || eventData?.id || eventId),
    role,
    content: appendDelta ? `${previousContent}${content}` : (content || previousContent),
    sessionId: text(eventData?.sessionId || currentMessage?.sessionId),
    parentSessionId: text(eventData?.parentSessionId || currentMessage?.parentSessionId),
    dialogProcessId: text(eventData?.dialogProcessId || currentMessage?.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId || currentMessage?.turnScopeId),
    workflowRunId: text(eventData?.workflowRunId || currentMessage?.workflowRunId),
    nodeExecutionId: text(eventData?.nodeExecutionId || currentMessage?.nodeExecutionId),
    eventName,
    eventId,
    revision: Number(eventData?.revision ?? currentMessage?.revision ?? 0),
    sequence: Number(eventData?.sequence ?? eventData?.seq ?? currentMessage?.sequence ?? 0),
    status: text(eventData?.status || eventData?.state || currentMessage?.status),
    createdAt: eventData?.createdAt || currentMessage?.createdAt || new Date().toISOString(),
    updatedAt: eventData?.updatedAt || new Date().toISOString(),
    thinking: eventData?.thinking ?? currentMessage?.thinking,
    toolCall: eventData?.toolCall ?? eventData?.tool_call ?? currentMessage?.toolCall,
    toolResult: eventData?.toolResult ?? eventData?.tool_result ?? currentMessage?.toolResult,
    rawEvents: [...(Array.isArray(currentMessage?.rawEvents) ? currentMessage.rawEvents : []), { event: eventName, data: eventData }].slice(-50),
  };
}

export const useChatStore = defineStore("chat", () => {
  const input = ref("");
  const uploadFiles = ref([]);
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const workflowNodeStateRegistry = ref(createWorkflowNodeStateRegistry());
  const subSessionMessageRegistry = ref(createSubSessionMessageRegistry());
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const pendingInteractionRequest = ref(null);
  const pendingInteractionRequests = ref([]);
  const interactionSubmitting = ref(false);

  const activeSession = computed(() =>
    sessions.value.find((sessionItem) => sessionItem.id === activeSessionId.value),
  );

  function resetChatStore() {
    input.value = "";
    uploadFiles.value = [];
    turnRuntimeRegistry.value = createTurnRuntimeRegistryState();
    workflowNodeStateRegistry.value = createWorkflowNodeStateRegistry();
    subSessionMessageRegistry.value = createSubSessionMessageRegistry();
    sessions.value = [];
    activeSessionId.value = "";
    loadingSessions.value = false;
    loadingSessionDetail.value = false;
    pendingInteractionRequest.value = null;
    pendingInteractionRequests.value = [];
    interactionSubmitting.value = false;
  }

  function upsertWorkflowNodeStateEvent(eventData = {}) {
    const workflowRunId = text(eventData?.workflowRunId);
    const nodeExecutionId = text(eventData?.nodeExecutionId);
    if (!workflowRunId || !nodeExecutionId) return { applied: false, reason: "missing_identity" };
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    if (!registry.workflows) registry.workflows = {};
    if (!registry.workflows[workflowRunId]) registry.workflows[workflowRunId] = { workflowRunId, nodes: {}, sequence: 0 };
    const workflow = registry.workflows[workflowRunId];
    if (!workflow.nodes) workflow.nodes = {};
    const current = workflow.nodes[nodeExecutionId] || null;
    if (!shouldApplyWorkflowNodeStateEvent(current, eventData)) {
      return { applied: false, reason: "stale", current };
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
    };
    workflow.nodes[nodeExecutionId] = next;
    workflow.sequence = Math.max(Number(workflow.sequence || 0), Number(next.sequence || 0));
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    return { applied: true, node: next };
  }

  function upsertWorkflowPlanningEvent(eventData = {}) {
    const workflowRunId = text(eventData?.workflowRunId);
    const nodeSessions = Array.isArray(eventData?.nodeSessions) ? eventData.nodeSessions : [];
    if (!workflowRunId || !nodeSessions.length) {
      return { applied: false, reason: "missing_planning_nodes" };
    }
    const registry = workflowNodeStateRegistry.value || createWorkflowNodeStateRegistry();
    registry.workflows = registry.workflows || {};
    const currentWorkflow = registry.workflows[workflowRunId] || { workflowRunId, nodes: {}, sequence: 0 };
    registry.workflows[workflowRunId] = {
      ...currentWorkflow,
      workflowRunId,
      sessionId: text(eventData?.sessionId || currentWorkflow.sessionId),
      dialogProcessId: text(eventData?.dialogProcessId || currentWorkflow.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId || currentWorkflow.turnScopeId),
      semanticText: text(eventData?.semanticText || currentWorkflow.semanticText),
      plannedAt: eventData?.createdAt || currentWorkflow.plannedAt || new Date().toISOString(),
    };
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    const results = nodeSessions.map((nodeSession = {}, index) => upsertWorkflowNodeStateEvent({
      ...(nodeSession || {}),
      sessionId: text(nodeSession?.sessionId || eventData?.sessionId),
      parentSessionId: text(nodeSession?.parentSessionId || eventData?.sessionId),
      workflowRunId: text(nodeSession?.workflowRunId) || workflowRunId,
      nodeExecutionId: text(nodeSession?.nodeExecutionId),
      status: text(nodeSession?.status || nodeSession?.stepStatus),
      stepStatus: text(nodeSession?.stepStatus || nodeSession?.status),
      revision: Number(nodeSession?.revision || 1),
      sequence: Number(nodeSession?.sequence || index + 1),
      eventId: text(nodeSession?.eventId) || `workflow-plan:${text(nodeSession?.nodeExecutionId)}`,
    }));
    return {
      applied: results.some((result) => result?.applied === true),
      results,
    };
  }

  function upsertSubSessionEvent(eventName = "", eventData = {}) {
    const sessionId = text(eventData?.sessionId || eventData?.subSessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    if (!registry.sessions) registry.sessions = {};
    const currentSession = registry.sessions[sessionId] || { sessionId, messages: [], eventsById: {}, sequence: 0 };
    const eventId = text(eventData?.eventId || eventData?.id) || `${text(eventData?.turnScopeId)}:${text(eventData?.seq || eventData?.sequence)}:${eventName}`;
    if (eventId && currentSession.eventsById?.[eventId]) {
      return { applied: false, reason: "duplicate", current: currentSession };
    }
    const messageKey = text(eventData?.messageId || eventData?.turnScopeId || eventId || sessionId);
    const messages = Array.isArray(currentSession.messages) ? [...currentSession.messages] : [];
    const existingIndex = messages.findIndex((message = {}) => text(message?.id || message?.messageId || message?.turnScopeId) === messageKey);
    const currentMessage = existingIndex >= 0 ? messages[existingIndex] : null;
    const nextMessage = normalizeSubSessionMessage(eventName, { ...eventData, sessionId, eventId }, currentMessage);
    if (existingIndex >= 0) messages[existingIndex] = nextMessage;
    else messages.push(nextMessage);
    messages.sort((a = {}, b = {}) => Number(a.sequence || 0) - Number(b.sequence || 0));
    const nextSession = {
      ...currentSession,
      sessionId,
      id: sessionId,
      parentSessionId: text(eventData?.parentSessionId || currentSession.parentSessionId),
      dialogProcessId: text(eventData?.dialogProcessId || currentSession.dialogProcessId),
      turnScopeId: text(eventData?.turnScopeId || currentSession.turnScopeId),
      workflowRunId: text(eventData?.workflowRunId || currentSession.workflowRunId),
      nodeExecutionId: text(eventData?.nodeExecutionId || currentSession.nodeExecutionId),
      status: text(eventData?.status || eventData?.state || currentSession.status),
      messages,
      eventsById: { ...(currentSession.eventsById || {}), ...(eventId ? { [eventId]: { ...eventData, eventId } } : {}) },
      sequence: Math.max(Number(currentSession.sequence || 0), Number(eventData?.sequence || eventData?.seq || 0)),
      revision: Math.max(Number(currentSession.revision || 0), Number(eventData?.revision || 0)),
      updatedAt: new Date().toISOString(),
    };
    registry.sessions[sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    return { applied: true, session: nextSession, message: nextMessage };
  }

  function mergeSubSessionSnapshot(sessionDoc = {}) {
    const sessionId = text(sessionDoc?.sessionId || sessionDoc?.id || sessionDoc?.backendSessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    const current = registry.sessions?.[sessionId] || { sessionId, messages: [], eventsById: {}, sequence: 0 };
    const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    registry.sessions = registry.sessions || {};
    registry.sessions[sessionId] = {
      ...current,
      ...sessionDoc,
      id: sessionId,
      sessionId,
      messages: messages.length ? messages : (Array.isArray(current.messages) ? current.messages : []),
      eventsById: current.eventsById || {},
      updatedAt: new Date().toISOString(),
    };
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    return { applied: true, session: registry.sessions[sessionId] };
  }

  function selectSubSessionMessages(sessionId = "") {
    const id = text(sessionId);
    if (!id) return null;
    return subSessionMessageRegistry.value?.sessions?.[id] || null;
  }

  function selectExecutionSession(executionId = "") {
    const execution = selectExecution(turnRuntimeRegistry.value, executionId);
    if (!execution) return null;
    const sessionId = text(execution.sessionId);
    if (!sessionId) return null;
    const mainSession = sessions.value.find((item = {}) => sessionRuntimeId(item) === sessionId);
    return mainSession || selectSubSessionMessages(sessionId);
  }

  function selectExecutionDescendants(executionId = "") {
    const rootId = text(executionId);
    if (!rootId || !selectExecution(turnRuntimeRegistry.value, rootId)) return [];
    const descendants = [];
    const visited = new Set([rootId]);
    const queue = [...selectExecutionChildren(turnRuntimeRegistry.value, rootId)];
    while (queue.length) {
      const child = queue.shift();
      const childId = text(child?.executionId);
      if (!childId || visited.has(childId)) continue;
      visited.add(childId);
      descendants.push(child);
      queue.push(...selectExecutionChildren(turnRuntimeRegistry.value, childId));
    }
    return descendants;
  }

  function selectExecutionDetail(executionId = "") {
    const execution = selectExecution(turnRuntimeRegistry.value, executionId);
    if (!execution) return null;
    const session = selectExecutionSession(execution.executionId);
    return {
      execution,
      session,
      messages: Array.isArray(session?.messages) ? session.messages : [],
      children: selectExecutionChildren(turnRuntimeRegistry.value, execution.executionId),
      descendants: selectExecutionDescendants(execution.executionId),
    };
  }

  return {
    input,
    uploadFiles,
    turnRuntimeRegistry,
    workflowNodeStateRegistry,
    subSessionMessageRegistry,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent,
    upsertSubSessionEvent,
    mergeSubSessionSnapshot,
    selectSubSessionMessages,
    selectExecutionSession,
    selectExecutionDescendants,
    selectExecutionDetail,
    resetChatStore,
  };
});
