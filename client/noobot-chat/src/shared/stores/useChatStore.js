/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  applyExecutionChildren,
  applyExecutionSnapshot,
  applyExecutionTree,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
  applyTurnTerminalResolution,
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
  hydrateSessionTurnRuntime,
  pruneTerminalTurns,
  selectExecution,
  selectExecutionChildren,
  sessionRuntimeId,
} from "../../composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import {
  hasMessageEventToolPayload,
  isMessageEventEnvelope,
  MESSAGE_CONTENT_EFFECT,
  projectMessageEventContent,
  projectMessageEventToolFacets,
} from "@noobot/shared/message-event-protocol";
import {
  compareWorkflowRuntimeFacts,
  normalizeWorkflowRuntimeEvent,
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/shared/workflow-runtime-event-protocol";
import { logWorkflowDiagnostics } from "../../composables/chat/debug/workflowDiagnosticsLogger";

function text(value) {
  return String(value || "").trim();
}

const SUB_SESSION_TERMINAL_STATUSES = new Set([
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "canceled",
  "stopped",
  "aborted",
  "error",
  "expired",
  "timeout",
  "no_conversation",
]);

function isSubSessionTerminalStatus(value) {
  return SUB_SESSION_TERMINAL_STATUSES.has(text(value).toLowerCase());
}

function eventTime(eventData = {}) {
  return eventData?.timestamp || eventData?.updatedAt || eventData?.createdAt || new Date().toISOString();
}

function projectSubSessionTurnState(currentSession = {}, eventData = {}) {
  const turnScopeId = text(eventData?.turnScopeId);
  if (!turnScopeId) {
    return {
      turnStatuses: Array.isArray(currentSession.turnStatuses) ? currentSession.turnStatuses : [],
      turnTimings: Array.isArray(currentSession.turnTimings) ? currentSession.turnTimings : [],
    };
  }
  const dialogProcessId = text(eventData?.dialogProcessId);
  const status = text(eventData?.status || eventData?.state).toLowerCase();
  const terminal = isSubSessionTerminalStatus(status);
  const timestamp = eventTime(eventData);
  const turnStatuses = [...(Array.isArray(currentSession.turnStatuses) ? currentSession.turnStatuses : [])];
  const statusIndex = turnStatuses.findIndex((item = {}) => text(item.turnScopeId) === turnScopeId);
  const currentStatus = statusIndex >= 0 ? turnStatuses[statusIndex] : {};
  const nextStatus = {
    ...currentStatus,
    turnScopeId,
    dialogProcessId: dialogProcessId || currentStatus.dialogProcessId || "",
    status: status || currentStatus.status || "sending",
    updatedAt: timestamp,
  };
  if (statusIndex >= 0) turnStatuses[statusIndex] = nextStatus;
  else turnStatuses.push(nextStatus);

  const turnTimings = [...(Array.isArray(currentSession.turnTimings) ? currentSession.turnTimings : [])];
  const timingIndex = turnTimings.findIndex((item = {}) => text(item.turnScopeId) === turnScopeId);
  const currentTiming = timingIndex >= 0 ? turnTimings[timingIndex] : {};
  const nextTiming = {
    ...currentTiming,
    turnScopeId,
    dialogProcessId: dialogProcessId || currentTiming.dialogProcessId || "",
    thinkingStartedAt: currentTiming.thinkingStartedAt || timestamp,
    thinkingFinishedAt: terminal ? (currentTiming.thinkingFinishedAt || timestamp) : null,
  };
  if (timingIndex >= 0) turnTimings[timingIndex] = nextTiming;
  else turnTimings.push(nextTiming);
  return { turnStatuses, turnTimings };
}

function createWorkflowNodeStateRegistry() {
  return { workflows: {}, viewerStates: {} };
}

function createSubSessionMessageRegistry() {
  return { sessions: {} };
}

function shouldApplyWorkflowNodeStateEvent(current = null, incoming = {}) {
  if (!current) return true;
  const comparison = compareWorkflowRuntimeFacts(incoming, current, {
    defaultDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
  });
  if (!comparison.comparable) return false;
  if (comparison.order !== 0) return comparison.order > 0;
  return text(incoming?.eventId) === text(current?.eventId);
}

function shouldApplyOrderedEvent(current = null, incoming = {}) {
  if (!current) return true;
  const comparison = compareWorkflowRuntimeFacts(incoming, current, {
    defaultDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
  });
  if (!comparison.comparable) return false;
  if (comparison.order !== 0) return comparison.order > 0;
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
  const canonicalContent = projectMessageEventContent(eventData);
  // Compatibility adapter for persisted/replayed child envelopes produced
  // before `llm_delta.text` became mandatory. Keep this at the workflow input
  // boundary; the shared canonical protocol remains strict.
  const incrementalContent = canonicalContent.effect === MESSAGE_CONTENT_EFFECT.APPEND &&
    canonicalContent.content === ""
    ? content
    : canonicalContent.content;
  const appendDelta = canonicalContent.effect === MESSAGE_CONTENT_EFFECT.APPEND ||
    Boolean(eventData?.delta) || String(eventName).includes("delta");
  const replaceContent = canonicalContent.effect === MESSAGE_CONTENT_EFFECT.REPLACE;
  const previousContent = String(currentMessage?.content || "");
  const nextContent = replaceContent
    ? canonicalContent.content
    : (appendDelta
        ? `${previousContent}${canonicalContent.effect === MESSAGE_CONTENT_EFFECT.APPEND ? incrementalContent : content}`
        : (content || previousContent));
  const { toolCall: canonicalToolCall, toolResult: canonicalToolResult } =
    projectMessageEventToolFacets(eventData);
  const status = text(eventData?.status || eventData?.state || currentMessage?.status);
  return {
    ...(currentMessage || {}),
    ...(eventData?.message && typeof eventData.message === "object" ? eventData.message : {}),
    id: authoritativeSubSessionMessageId(eventData) || text(currentMessage?.id),
    messageId: authoritativeSubSessionMessageId(eventData) || text(currentMessage?.messageId),
    role,
    // Tool payload text belongs in the thinking/tool-log projection. Replacing
    // assistant content with it makes the assistant thinking card (including a
    // rendered workflow graph) disappear as soon as the first tool completes.
    content: toolEvent && currentMessage
      ? previousContent
      : nextContent,
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
    sequenceDomain: text(eventData?.sequenceDomain || currentMessage?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
    ...(replaceContent ? { finalContentSequence: Number(eventData?.sequence || 0) } : {}),
    firstSequence: Number(currentMessage?.firstSequence ?? eventData?.sequence ?? eventData?.seq ?? 0),
    status,
    pending: eventData?.pending ?? currentMessage?.pending,
    createdAt: eventData?.createdAt || eventData?.timestamp || currentMessage?.createdAt || new Date().toISOString(),
    updatedAt: eventData?.updatedAt || eventData?.timestamp || new Date().toISOString(),
    thinking: eventData?.thinking ?? currentMessage?.thinking,
    toolCall: canonicalToolCall ?? currentMessage?.toolCall,
    toolResult: canonicalToolResult ?? currentMessage?.toolResult,
    rawEvents: [...(Array.isArray(currentMessage?.rawEvents) ? currentMessage.rawEvents : []), { event: eventName, data: eventData }].slice(-50),
  };
}

function mergePersistedMessageValue(realtimeValue, persistedValue) {
  // A completion snapshot is authoritative for values it actually contains,
  // but it is not a full replacement for the richer realtime projection.
  // Session persistence intentionally omits transport-only facets and older
  // documents may serialize omitted facets as null/empty containers.
  if (persistedValue == null) return realtimeValue;
  if (Array.isArray(persistedValue)) {
    return persistedValue.length || !Array.isArray(realtimeValue) || !realtimeValue.length
      ? persistedValue
      : realtimeValue;
  }
  if (persistedValue && typeof persistedValue === "object") {
    const realtimeObject = realtimeValue && typeof realtimeValue === "object" && !Array.isArray(realtimeValue)
      ? realtimeValue
      : {};
    return Object.fromEntries(
      new Set([...Object.keys(realtimeObject), ...Object.keys(persistedValue)])
        .values()
        .map((key) => [key, mergePersistedMessageValue(realtimeObject[key], persistedValue[key])]),
    );
  }
  if (persistedValue === "" && typeof realtimeValue === "string" && realtimeValue) return realtimeValue;
  return persistedValue;
}

function mergePersistedSubSessionMessage(realtime = {}, snapshot = {}, messageId = "") {
  const merged = mergePersistedMessageValue(realtime, snapshot);
  const authoritativeRealtimeId = (
    text(realtime.sequenceDomain) === WORKFLOW_SEQUENCE_DOMAIN.MESSAGE && text(realtime.eventId)
  ) ? text(realtime.messageId || realtime.id) : "";
  const canonicalMessageId = authoritativeRealtimeId || text(messageId);
  return {
    ...merged,
    ...(canonicalMessageId ? { id: canonicalMessageId, messageId: canonicalMessageId } : {}),
    // Event history is a realtime projection and is not part of session.json.
    rawEvents: Array.isArray(realtime.rawEvents) ? realtime.rawEvents : merged.rawEvents,
    eventId: realtime.eventId,
    sequence: realtime.sequence,
    firstSequence: realtime.firstSequence,
    revision: realtime.revision,
    sequenceDomain: text(realtime.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
  };
}

function normalizeSubSessionSnapshotMessage(snapshot = {}) {
  if (text(snapshot?.sequenceDomain) === WORKFLOW_SEQUENCE_DOMAIN.MESSAGE) return snapshot;
  const {
    eventId: _eventId,
    sequence: _sequence,
    firstSequence: _firstSequence,
    revision: _revision,
    sequenceDomain: _sequenceDomain,
    ...content
  } = snapshot && typeof snapshot === "object" ? snapshot : {};
  return content;
}

function subSessionMessageIdentity(message = {}) {
  const stableId = text(message?.messageId || message?.id || message?.additional_kwargs?.noobotMessageId);
  if (stableId) return `id:${stableId}`;
  const role = text(message?.role || message?.type).toLowerCase();
  const turnScopeId = text(message?.turnScopeId || message?.metadata?.turnScopeId);
  if (turnScopeId && role) return `turn:${turnScopeId}:${role}`;
  const dialogProcessId = text(message?.dialogProcessId || message?.metadata?.dialogProcessId);
  if (dialogProcessId && role) return `dialog:${dialogProcessId}:${role}`;
  return "";
}

function subSessionMessageIdentityCandidates(message = {}) {
  const role = text(message?.role || message?.type).toLowerCase();
  return [
    text(message?.messageId || message?.id || message?.additional_kwargs?.noobotMessageId)
      ? `id:${text(message?.messageId || message?.id || message?.additional_kwargs?.noobotMessageId)}`
      : "",
    text(message?.turnScopeId || message?.metadata?.turnScopeId) && role
      ? `turn:${text(message?.turnScopeId || message?.metadata?.turnScopeId)}:${role}`
      : "",
    text(message?.dialogProcessId || message?.metadata?.dialogProcessId) && role
      ? `dialog:${text(message?.dialogProcessId || message?.metadata?.dialogProcessId)}:${role}`
      : "",
  ].filter(Boolean);
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

  // Runtime reducers deliberately mutate one registry instance so a complete
  // event batch is atomic.  Pinia consumers, however, subscribe at the store
  // boundary.  Publish a new root after every effective reduction; otherwise
  // renderers which selected a previously missing Turn are not invalidated.
  function commitTurnRuntime(reducer, ...args) {
    const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
    const result = reducer(registry, ...args);
    const applied = result?.applied !== false;
    if (applied) turnRuntimeRegistry.value = { ...registry };
    return result;
  }

  const applyTurnRuntimeEventAction = (event) =>
    commitTurnRuntime(applyTurnRuntimeEvent, event);
  const applyTurnLifecycleEnvelopeAction = (envelope) =>
    commitTurnRuntime(applyTurnLifecycleEnvelope, envelope);
  const applyTurnLifecycleSnapshotAction = (snapshot) =>
    commitTurnRuntime(applyTurnLifecycleSnapshot, snapshot);
  const applyTurnTimingSnapshotAction = (snapshot) =>
    commitTurnRuntime(applyTurnTimingSnapshot, snapshot);
  const applyTurnTerminalResolutionAction = (response) =>
    commitTurnRuntime(applyTurnTerminalResolution, response);
  const applyExecutionSnapshotAction = (payload) =>
    commitTurnRuntime(applyExecutionSnapshot, payload);
  const applyExecutionChildrenAction = (payload) =>
    commitTurnRuntime(applyExecutionChildren, payload);
  const applyExecutionTreeAction = (payload) =>
    commitTurnRuntime(applyExecutionTree, payload);
  function hydrateSessionTurnRuntimeAction(session, turnStatuses) {
    const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
    const result = hydrateSessionTurnRuntime(registry, session, turnStatuses);
    // Session hydration runs on a deep watch over `sessions`; only publish a new
    // registry root when an authoritative turn was actually reconciled, otherwise
    // every unrelated session mutation re-roots the registry and can feed the
    // watch back into itself.
    if (result?.applied) turnRuntimeRegistry.value = { ...registry };
    return result;
  }

  function pruneTerminalTurnsAction(options = {}) {
    const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
    const result = pruneTerminalTurns(registry, options);
    const applied = Array.isArray(result?.removedTurnScopeIds) && result.removedTurnScopeIds.length > 0;
    if (applied) turnRuntimeRegistry.value = { ...registry };
    return { ...(result || {}), applied };
  }

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

  function upsertSubSessionEvent(eventName = "", eventData = {}) {
    // A standard envelope carries semantic type in data. The WebSocket event
    // name is transport routing only and must not influence projection.
    if (!isMessageEventEnvelope(eventData)) {
      return { applied: false, reason: "not_authoritative_message_event" };
    }
    const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.MESSAGE;
    if (sequenceDomain !== WORKFLOW_SEQUENCE_DOMAIN.MESSAGE) {
      return { applied: false, reason: "sequence_domain_mismatch" };
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
    const incoming = { ...eventData, sessionId, eventId, sequenceDomain };
    const messageKey = authoritativeSubSessionMessageId(incoming);
    let existingIndex = messageKey
      ? messages.findIndex((message = {}) => text(message?.messageId || message?.id) === messageKey)
      : -1;
    // A refresh may hydrate an Assistant shell before its canonical message
    // event is replayed. Resolve that shell through the stable Turn identity,
    // then let the canonical messageId take ownership of the same entity.
    if (existingIndex < 0 && messageKey) {
      const incomingRole = text(incoming.role) || "assistant";
      const incomingTurnScopeId = text(incoming.turnScopeId || incoming.metadata?.turnScopeId);
      const incomingDialogProcessId = text(incoming.dialogProcessId || incoming.metadata?.dialogProcessId);
      // Turn is the stronger ownership boundary. Dialog is only a legacy
      // fallback when the producer cannot identify a Turn at all.
      const fallbackIdentity = incomingTurnScopeId
        ? `turn:${incomingTurnScopeId}:${incomingRole}`
        : (incomingDialogProcessId ? `dialog:${incomingDialogProcessId}:${incomingRole}` : "");
      const identityMatches = messages
        .map((message = {}, index) => ({ message, index }))
        .filter(({ message }) => fallbackIdentity && subSessionMessageIdentityCandidates(message)
          .includes(fallbackIdentity));
      if (identityMatches.length === 1) existingIndex = identityMatches[0].index;
    }
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
    const turnState = projectSubSessionTurnState(currentSession, eventData);
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
      turnStatuses: turnState.turnStatuses,
      turnTimings: turnState.turnTimings,
      eventsById: { ...(currentSession.eventsById || {}), ...(eventId ? { [eventId]: { ...eventData, eventId } } : {}) },
      sequence: Math.max(Number(currentSession.sequence || 0), Number(eventData?.sequence || 0)),
      sequenceDomain,
      sequenceByDomain: {
        ...(currentSession.sequenceByDomain || {}),
        [WORKFLOW_SEQUENCE_DOMAIN.MESSAGE]: Math.max(
          Number(currentSession.sequenceByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.MESSAGE] || 0),
          Number(eventData?.sequence || 0),
        ),
      },
      revision: Math.max(Number(currentSession.revision || 0), Number(eventData?.revision || 0)),
      revisionByDomain: {
        ...(currentSession.revisionByDomain || {}),
        [WORKFLOW_SEQUENCE_DOMAIN.MESSAGE]: Math.max(
          Number(currentSession.revisionByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.MESSAGE] || 0),
          Number(eventData?.revision || 0),
        ),
      },
      updatedAt: eventTime(eventData),
    };
    registry.sessions[sessionId] = nextSession;
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    return { applied: true, session: nextSession, message: nextMessage };
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

  function mergeSubSessionSnapshot(sessionDoc = {}) {
    const sessionId = text(sessionDoc?.sessionId || sessionDoc?.id || sessionDoc?.backendSessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
    const current = registry.sessions?.[sessionId] || { sessionId, messages: [], eventsById: {}, sequence: 0 };
    const currentStatus = text(current?.status || current?.state).toLowerCase();
    const snapshotStatus = text(sessionDoc?.status || sessionDoc?.state).toLowerCase();
    const mergedStatus = isSubSessionTerminalStatus(currentStatus) && !isSubSessionTerminalStatus(snapshotStatus)
      ? currentStatus
      : (snapshotStatus || currentStatus);
    const snapshotMessages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    const realtimeMessages = Array.isArray(current.messages) ? current.messages : [];
    const realtimeIndexByIdentity = new Map();
    realtimeMessages.forEach((message = {}, index) => {
      for (const identity of subSessionMessageIdentityCandidates(message)) {
        if (!realtimeIndexByIdentity.has(identity)) realtimeIndexByIdentity.set(identity, index);
      }
    });
    const claimedRealtimeIndexes = new Set();
    const messages = snapshotMessages.map((rawSnapshot = {}) => {
      const snapshot = normalizeSubSessionSnapshotMessage(rawSnapshot);
      const messageId = text(snapshot.messageId || snapshot.id || snapshot?.additional_kwargs?.noobotMessageId);
      const realtimeIndex = subSessionMessageIdentityCandidates(snapshot)
        .map((identity) => realtimeIndexByIdentity.get(identity))
        .find((index) => Number.isInteger(index));
      const realtime = Number.isInteger(realtimeIndex) ? realtimeMessages[realtimeIndex] : null;
      if (Number.isInteger(realtimeIndex)) claimedRealtimeIndexes.add(realtimeIndex);
      if (!realtime) return snapshot;
      return mergePersistedSubSessionMessage(
        realtime,
        snapshot,
        messageId || text(realtime.messageId || realtime.id),
      );
    });
    realtimeMessages.forEach((realtime, index) => {
      if (!claimedRealtimeIndexes.has(index)) messages.push(realtime);
    });
    const deduplicatedMessages = [];
    const deduplicatedIndexByIdentity = new Map();
    for (const message of messages) {
      const identity = subSessionMessageIdentity(message);
      if (!identity || !deduplicatedIndexByIdentity.has(identity)) {
        if (identity) deduplicatedIndexByIdentity.set(identity, deduplicatedMessages.length);
        deduplicatedMessages.push(message);
        continue;
      }
      const index = deduplicatedIndexByIdentity.get(identity);
      const previous = deduplicatedMessages[index];
      deduplicatedMessages[index] = mergePersistedSubSessionMessage(
        previous,
        message,
        text(message?.messageId || message?.id || previous?.messageId || previous?.id),
      );
    }
    registry.sessions = registry.sessions || {};
    registry.sessions[sessionId] = {
      ...current,
      ...sessionDoc,
      id: sessionId,
      sessionId,
      status: mergedStatus,
      messages: deduplicatedMessages,
      sequence: Number(current.sequence || 0),
      sequenceDomain: text(current.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
      sequenceByDomain: { ...(current.sequenceByDomain || {}) },
      revision: Number(current.revision || 0),
      revisionByDomain: { ...(current.revisionByDomain || {}) },
      turnStatuses: isSubSessionTerminalStatus(currentStatus) && !isSubSessionTerminalStatus(snapshotStatus)
        ? (current.turnStatuses || [])
        : Array.isArray(sessionDoc?.turnStatuses)
        ? sessionDoc.turnStatuses
        : (current.turnStatuses || []),
      turnTimings: isSubSessionTerminalStatus(currentStatus) && !isSubSessionTerminalStatus(snapshotStatus)
        ? (current.turnTimings || [])
        : Array.isArray(sessionDoc?.turnTimings)
        ? sessionDoc.turnTimings
        : (current.turnTimings || []),
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
    applyTurnRuntimeEvent: applyTurnRuntimeEventAction,
    applyTurnLifecycleEnvelope: applyTurnLifecycleEnvelopeAction,
    applyTurnLifecycleSnapshot: applyTurnLifecycleSnapshotAction,
    applyTurnTimingSnapshot: applyTurnTimingSnapshotAction,
    applyTurnTerminalResolution: applyTurnTerminalResolutionAction,
    applyExecutionSnapshot: applyExecutionSnapshotAction,
    applyExecutionChildren: applyExecutionChildrenAction,
    applyExecutionTree: applyExecutionTreeAction,
    hydrateSessionTurnRuntime: hydrateSessionTurnRuntimeAction,
    pruneTerminalTurns: pruneTerminalTurnsAction,
    upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent,
    upsertSubSessionEvent,
    applyWorkflowRuntimeEvent,
    mergeSubSessionSnapshot,
    selectSubSessionMessages,
    selectExecutionSession,
    selectExecutionDescendants,
    selectExecutionDetail,
    resetChatStore,
  };
});
