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
import {
  hasMessageEventToolPayload,
  isMessageEventEnvelope,
  projectMessageEventToolFacets,
} from "@noobot/shared/message-event-protocol";

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

function isSubSessionToolEvent(eventName = "", eventData = {}) {
  return String(eventName).includes("tool") || Boolean(
    eventData?.toolCall || eventData?.tool_call || eventData?.toolResult || eventData?.tool_result ||
    eventData?.toolCallId || eventData?.tool_call_id,
  );
}

function authoritativeSubSessionMessageId(eventData = {}) {
  return text(eventData?.messageId);
}

function hasSubSessionMessagePayload(eventName = "", eventData = {}, currentMessage = null) {
  if (eventContent(eventData)) return true;
  if (eventData?.message && typeof eventData.message === "object") return true;
  if (eventData?.thinking || eventData?.toolCall || eventData?.tool_call || eventData?.toolResult || eventData?.tool_result) return true;
  if (isSubSessionToolEvent(eventName, eventData) && hasMessageEventToolPayload(eventData)) return true;
  // Lifecycle/status-only events update the sub-session status.  They may enrich
  // an already materialized runtime message, but must not create an empty
  // placeholder that later survives alongside the persisted snapshot.
  if (currentMessage && text(eventData?.status || eventData?.state) && (String(eventName).includes("lifecycle") || String(eventName).includes("status"))) return true;
  return false;
}

function normalizeSubSessionMessage(eventName = "", eventData = {}, currentMessage = null) {
  const content = eventContent(eventData);
  const toolEvent = isSubSessionToolEvent(eventName, eventData);
  // Tool lifecycle is a facet of the addressed Assistant entity. The explicit
  // eventType defines that projection; a producer-side tool role must not
  // mutate the owning message entity into a separate Tool message.
  const role = toolEvent
    ? (text(currentMessage?.role) || "assistant")
    : (text(eventData?.role || currentMessage?.role) || "assistant");
  const eventId = text(eventData?.eventId);
  const appendDelta = Boolean(eventData?.delta) || String(eventName).includes("delta");
  const previousContent = String(currentMessage?.content || "");
  const { toolCall: canonicalToolCall, toolResult: canonicalToolResult } =
    projectMessageEventToolFacets(eventData);
  return {
    ...(currentMessage || {}),
    ...(eventData?.message && typeof eventData.message === "object" ? eventData.message : {}),
    id: text(currentMessage?.id) || authoritativeSubSessionMessageId(eventData),
    messageId: text(currentMessage?.messageId) || authoritativeSubSessionMessageId(eventData),
    role,
    // Tool payload text belongs in the thinking/tool-log projection. Replacing
    // assistant content with it makes the assistant thinking card (including a
    // rendered workflow graph) disappear as soon as the first tool completes.
    content: toolEvent && currentMessage
      ? previousContent
      : (appendDelta ? `${previousContent}${content}` : (content || previousContent)),
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
    firstSequence: Number(currentMessage?.firstSequence ?? eventData?.sequence ?? eventData?.seq ?? 0),
    status: text(eventData?.status || eventData?.state || currentMessage?.status),
    createdAt: eventData?.createdAt || currentMessage?.createdAt || new Date().toISOString(),
    updatedAt: eventData?.updatedAt || new Date().toISOString(),
    thinking: eventData?.thinking ?? currentMessage?.thinking,
    toolCall: canonicalToolCall ?? currentMessage?.toolCall,
    toolResult: canonicalToolResult ?? currentMessage?.toolResult,
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
      // The first planning event establishes the parent conversation anchor.
      // Nested workflow agents may reuse the same workflowRunId while carrying
      // their child Session/process/turn identity. Do not let that child scope
      // move the top-level live projection away from its parent thinking card.
      sessionId: text(currentWorkflow.sessionId || eventData?.sessionId),
      dialogProcessId: text(currentWorkflow.dialogProcessId || eventData?.dialogProcessId),
      turnScopeId: text(currentWorkflow.turnScopeId || eventData?.turnScopeId),
      semanticText: text(eventData?.semanticText || currentWorkflow.semanticText),
      plannedAt: eventData?.createdAt || currentWorkflow.plannedAt || new Date().toISOString(),
    };
    workflowNodeStateRegistry.value = { ...registry, workflows: { ...registry.workflows } };
    const results = nodeSessions.map((nodeSession = {}, index) => upsertWorkflowNodeStateEvent({
      ...(nodeSession || {}),
      // A planned node does not own the workflow's parent Session.  Keep the
      // child identity empty until the backend allocates it; otherwise the
      // node drawer can subscribe to and render the main conversation.
      sessionId: text(nodeSession?.sessionId || nodeSession?.nodeSessionId),
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
    // A standard envelope carries semantic type in data. The WebSocket event
    // name is transport routing only and must not influence projection.
    if (!isMessageEventEnvelope(eventData)) {
      return { applied: false, reason: "not_authoritative_message_event" };
    }
    const projectionEventName = text(eventData?.eventType);
    const sessionId = text(eventData?.sessionId || eventData?.subSessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    if (!registry.sessions) registry.sessions = {};
    const currentSession = registry.sessions[sessionId] || { sessionId, messages: [], eventsById: {}, sequence: 0 };
    const eventId = text(eventData?.eventId);
    if (!eventId || !projectionEventName || !authoritativeSubSessionMessageId(eventData) || Number(eventData?.sequence) <= 0) {
      return { applied: false, reason: "invalid_authoritative_message_event" };
    }
    if (eventId && currentSession.eventsById?.[eventId]) {
      return { applied: false, reason: "duplicate", current: currentSession };
    }
    const messages = Array.isArray(currentSession.messages) ? [...currentSession.messages] : [];
    const incoming = { ...eventData, sessionId, eventId };
    const messageKey = authoritativeSubSessionMessageId(incoming);
    const existingIndex = messageKey
      ? messages.findIndex((message = {}) => text(message?.messageId || message?.id) === messageKey)
      : -1;
    const currentMessage = existingIndex >= 0 ? messages[existingIndex] : null;
    let nextMessage = currentMessage;
    const hasMessagePayload = hasSubSessionMessagePayload(projectionEventName, eventData, currentMessage);
    if (hasMessagePayload && !messageKey) {
      return { applied: false, reason: "missing_message_identity", current: currentSession };
    }
    if (hasMessagePayload) {
      if (currentMessage && !shouldApplyOrderedEvent(currentMessage, incoming)) {
        return { applied: false, reason: "stale", current: currentSession, message: currentMessage };
      }
      nextMessage = normalizeSubSessionMessage(projectionEventName, incoming, currentMessage);
      if (existingIndex >= 0) messages[existingIndex] = nextMessage;
      else messages.push(nextMessage);
    }
    messages.sort((a = {}, b = {}) => Number(a.firstSequence || a.sequence || 0) - Number(b.firstSequence || b.sequence || 0));
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
    const snapshotMessages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    const realtimeMessages = Array.isArray(current.messages) ? current.messages : [];
    const realtimeById = new Map(realtimeMessages.map((message = {}) => [text(message.messageId || message.id), message]));
    const claimedIds = new Set();
    const messages = snapshotMessages.map((snapshot = {}) => {
      const messageId = text(snapshot.messageId || snapshot.id || snapshot?.additional_kwargs?.noobotMessageId);
      const realtime = messageId ? realtimeById.get(messageId) : null;
      if (messageId) claimedIds.add(messageId);
      if (!realtime) return snapshot;
      return {
        ...realtime,
        ...snapshot,
        id: messageId,
        messageId,
        thinking: snapshot.thinking ?? realtime.thinking,
        toolCall: snapshot.toolCall ?? realtime.toolCall,
        toolResult: snapshot.toolResult ?? realtime.toolResult,
        rawEvents: realtime.rawEvents,
      };
    });
    for (const realtime of realtimeMessages) {
      const messageId = text(realtime.messageId || realtime.id);
      if (!messageId || !claimedIds.has(messageId)) messages.push(realtime);
    }
    registry.sessions = registry.sessions || {};
    registry.sessions[sessionId] = {
      ...current,
      ...sessionDoc,
      id: sessionId,
      sessionId,
      messages,
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
