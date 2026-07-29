/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  hasMessageEventToolPayload, isMessageEventEnvelope, MESSAGE_CONTENT_EFFECT,
  isAuthoritativeFinalContentEvent,
  projectMessageEventContent, projectMessageEventToolFacets,
  resolveMessageEventSequenceIdentity, validateMessageEventEnvelope,
} from "@noobot/shared/message-event-protocol";
import { WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/shared/workflow-runtime-event-protocol";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";

function text(value) { return String(value || "").trim(); }

const SUB_SESSION_TERMINAL_STATUSES = new Set([
  "completed", "succeeded", "failed", "cancelled", "canceled", "stopped",
  "aborted", "error", "expired", "timeout", "no_conversation",
]);

function isSubSessionTerminalStatus(value) {
  return SUB_SESSION_TERMINAL_STATUSES.has(text(value).toLowerCase());
}

function eventTime(eventData = {}) {
  return eventData?.timestamp || eventData?.updatedAt || eventData?.createdAt || new Date().toISOString();
}

function compareMessageEventOrder(left = {}, right = {}) {
  const leftIdentity = resolveMessageEventSequenceIdentity(left);
  const rightIdentity = resolveMessageEventSequenceIdentity(right);
  if (
    leftIdentity.sequenceKey &&
    leftIdentity.sequenceKey === rightIdentity.sequenceKey &&
    leftIdentity.sequence !== rightIdentity.sequence
  ) return leftIdentity.sequence - rightIdentity.sequence;
  const leftTime = Date.parse(text(left?.timestamp || left?.updatedAt || left?.createdAt));
  const rightTime = Date.parse(text(right?.timestamp || right?.updatedAt || right?.createdAt));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
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

function shouldApplyOrderedEvent(current = null, incoming = {}) {
  if (!current) return true;
  const incomingIdentity = resolveMessageEventSequenceIdentity(incoming);
  const currentIdentity = resolveMessageEventSequenceIdentity(current);
  const currentIsAuthoritativeMessageEvent = Boolean(
    text(current?.eventId) &&
    text(current?.sequenceDomain) === WORKFLOW_SEQUENCE_DOMAIN.MESSAGE &&
    currentIdentity.sequenceKey,
  );
  // A persisted/runtime assistant shell belongs to the same Turn projection, but
  // does not own the authoritative message-event sequence lane. The first
  // canonical event must be allowed to take over that shell regardless of any
  // revision/sequence metadata written by another workflow domain.
  if (!currentIsAuthoritativeMessageEvent) return true;
  if (!incomingIdentity.sequenceKey || incomingIdentity.sequenceKey !== currentIdentity.sequenceKey) {
    return true;
  }
  if (incomingIdentity.sequence !== currentIdentity.sequence) {
    return incomingIdentity.sequence > currentIdentity.sequence;
  }
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
  if (currentMessage && text(eventData?.status || eventData?.state) && (String(eventName).includes("lifecycle") || String(eventName).includes("status"))) return true;
  return false;
}

function normalizeSubSessionMessage(eventName = "", eventData = {}, currentMessage = null) {
  const content = eventContent(eventData);
  const toolEvent = isSubSessionToolEvent(eventName, eventData);
  const role = toolEvent
    ? (text(currentMessage?.role) || "assistant")
    : (text(eventData?.role || currentMessage?.role) || "assistant");
  const eventId = text(eventData?.eventId);
  const canonicalContent = projectMessageEventContent(eventData);
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
  const sequenceIdentity = resolveMessageEventSequenceIdentity(eventData);
  return {
    ...(currentMessage || {}),
    ...(eventData?.message && typeof eventData.message === "object" ? eventData.message : {}),
    id: authoritativeSubSessionMessageId(eventData) || text(currentMessage?.id),
    messageId: authoritativeSubSessionMessageId(eventData) || text(currentMessage?.messageId),
    role,
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
    sequenceScopeId: sequenceIdentity.sequenceScopeId || text(currentMessage?.sequenceScopeId),
    ...(isAuthoritativeFinalContentEvent(eventData)
      ? { finalContentSequence: Number(eventData?.sequence || 0) }
      : {}),
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

function mergePersistedSubSessionMessage(realtime = {}, snapshot = {}, messageId = "") {
  const canonicalMessageId = text(messageId || realtime.messageId || realtime.id);
  const realtimeOwnsFinalContent = Number(realtime?.finalContentSequence || 0) > 0;
  // Ownership is explicit and independent from arrival order. A canonical
  // replace event owns final content once committed; otherwise the persisted
  // snapshot owns canonical content. Realtime always owns event-only facets
  // which snapshots do not necessarily serialize. Both facts must carry the
  // same stable messageId before this function is called.
  const merged = {
    ...realtime,
    ...snapshot,
    ...(realtimeOwnsFinalContent ? {
      content: realtime.content,
      finalContentSequence: realtime.finalContentSequence,
      eventName: realtime.eventName,
      eventId: realtime.eventId,
      revision: realtime.revision,
      sequence: realtime.sequence,
      sequenceDomain: realtime.sequenceDomain,
      sequenceScopeId: realtime.sequenceScopeId,
      firstSequence: realtime.firstSequence,
      updatedAt: realtime.updatedAt,
    } : {}),
    ...(realtime.thinking !== undefined ? { thinking: realtime.thinking } : {}),
    ...(realtime.toolCall !== undefined ? { toolCall: realtime.toolCall } : {}),
    ...(realtime.toolResult !== undefined ? { toolResult: realtime.toolResult } : {}),
    ...(Array.isArray(realtime.rawEvents) ? { rawEvents: realtime.rawEvents } : {}),
  };
  return {
    ...merged,
    ...(canonicalMessageId ? { id: canonicalMessageId, messageId: canonicalMessageId } : {}),
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
    sequenceScopeId: _sequenceScopeId,
    ...content
  } = snapshot && typeof snapshot === "object" ? snapshot : {};
  return content;
}

function subSessionMessageIdentity(message = {}) {
  const stableId = text(message?.messageId || message?.id || message?.additional_kwargs?.noobotMessageId);
  return stableId ? `id:${stableId}` : "";
}

function subSessionMessageIdentityCandidates(message = {}) {
  const identity = subSessionMessageIdentity(message);
  return identity ? [identity] : [];
}


export function createSubSessionMessageRegistry() { return { sessions: {} }; }

export function createSubSessionStore({ subSessionMessageRegistry, subSessionMessageRegistryVersion }) {
function applySubSessionLifecycleEvent(eventData = {}) {
  const sessionId = text(eventData?.sessionId || eventData?.subSessionId);
  if (!sessionId) return { applied: false, reason: "missing_session" };
  const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
  registry.sessions = registry.sessions || {};
  const currentSession = registry.sessions[sessionId] || {
    id: sessionId,
    sessionId,
    messages: [],
    eventsById: {},
    sequence: 0,
  };
  const turnState = projectSubSessionTurnState(currentSession, eventData);
  const sequenceDomain = text(eventData?.sequenceDomain) || WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE;
  const sequence = Number(eventData?.sequence || 0);
  const revision = Number(eventData?.revision || 0);
  const nextSession = {
    ...currentSession,
    id: sessionId,
    sessionId,
    parentSessionId: text(eventData?.parentSessionId || currentSession.parentSessionId),
    dialogProcessId: text(eventData?.dialogProcessId || currentSession.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId || currentSession.turnScopeId),
    workflowRunId: text(eventData?.workflowRunId || currentSession.workflowRunId),
    nodeExecutionId: text(eventData?.nodeExecutionId || currentSession.nodeExecutionId),
    status: text(eventData?.status || eventData?.state || currentSession.status),
    turnStatuses: turnState.turnStatuses,
    turnTimings: turnState.turnTimings,
    sequenceByDomain: {
      ...(currentSession.sequenceByDomain || {}),
      [sequenceDomain]: Math.max(Number(currentSession.sequenceByDomain?.[sequenceDomain] || 0), sequence),
    },
    revisionByDomain: {
      ...(currentSession.revisionByDomain || {}),
      [sequenceDomain]: Math.max(Number(currentSession.revisionByDomain?.[sequenceDomain] || 0), revision),
    },
    updatedAt: eventTime(eventData),
  };
  registry.sessions[sessionId] = nextSession;
  subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
  if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
  return { applied: true, session: nextSession };
}

function upsertSubSessionEvent(eventName = "", eventData = {}) {
  if (!isMessageEventEnvelope(eventData)) {
    return { applied: false, reason: "not_authoritative_message_event" };
  }
  const envelopeValidation = validateMessageEventEnvelope(eventData);
  const sequenceIdentityErrors = envelopeValidation.errors.filter((error) =>
    String(error).startsWith("sequence_") || error === "missing_sequence_scope",
  );
  if (sequenceIdentityErrors.length) {
    return {
      applied: false,
      reason: "invalid_authoritative_message_event",
      errors: sequenceIdentityErrors,
    };
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
  const incomingSequenceIdentity = resolveMessageEventSequenceIdentity(eventData);
  const appliedSequence = Number(
    currentSession.sequenceByScopeKey?.[incomingSequenceIdentity.sequenceKey] || 0,
  );
  if (
    incomingSequenceIdentity.sequenceKey &&
    incomingSequenceIdentity.sequence > 0 &&
    appliedSequence === incomingSequenceIdentity.sequence
  ) {
    return { applied: false, reason: "duplicate_sequence", current: currentSession };
  }
  const messages = Array.isArray(currentSession.messages) ? [...currentSession.messages] : [];
  const incoming = { ...eventData, sessionId, eventId, sequenceDomain };
  const messageKey = authoritativeSubSessionMessageId(incoming);
  let existingIndex = messageKey
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
  messages.sort(compareMessageEventOrder);
  const turnState = projectSubSessionTurnState(currentSession, eventData);
  const appliedIncomingSequenceIdentity = resolveMessageEventSequenceIdentity(incoming);
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
    sequenceByScopeKey: {
      ...(currentSession.sequenceByScopeKey || {}),
      [appliedIncomingSequenceIdentity.sequenceKey]: Math.max(
        Number(currentSession.sequenceByScopeKey?.[
          appliedIncomingSequenceIdentity.sequenceKey
        ] || 0),
        Number(eventData?.sequence || 0),
      ),
    },
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
  if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
  logWorkflowDiagnostics("frontend.workflowSubSession.registryCommitted", {
    sessionId: text(eventData?.parentSessionId || sessionId),
    nodeSessionId: sessionId,
    dialogProcessId: text(eventData?.dialogProcessId),
    turnScopeId: text(eventData?.turnScopeId),
    messageId: messageKey,
    eventType: projectionEventName,
    contentLength: String(nextMessage?.content || "").length,
    messageCount: messages.length,
    subSessionMessageRegistryVersion: Number(subSessionMessageRegistryVersion?.value || 0),
  });
  return { applied: true, session: nextSession, message: nextMessage };
}

function reduceSubSessionSnapshot(sessionDoc = {}) {
  const sessionId = text(sessionDoc?.sessionId || sessionDoc?.id || sessionDoc?.backendSessionId);
  if (!sessionId) return { applied: false, reason: "missing_session" };
  const registry = subSessionMessageRegistry.value || createSubSessionMessageRegistry();
  const current = registry.sessions?.[sessionId] || { sessionId, messages: [], eventsById: {}, sequence: 0 };
  const snapshotVersion = Number(sessionDoc?.snapshotVersion || sessionDoc?.sessionVersion || sessionDoc?.revision || 1);
  const appliedSnapshotVersion = Number(
    current.sequenceByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT] || 0,
  );
  if (appliedSnapshotVersion && snapshotVersion <= appliedSnapshotVersion) {
    return {
      applied: false,
      reason: snapshotVersion === appliedSnapshotVersion ? "duplicate_snapshot_version" : "stale_snapshot",
      current,
    };
  }
  const currentStatus = text(current?.status || current?.state).toLowerCase();
  const snapshotStatus = text(sessionDoc?.status || sessionDoc?.state).toLowerCase();
  const mergedStatus = isSubSessionTerminalStatus(currentStatus)
    ? currentStatus
    : (snapshotStatus || currentStatus);
  const snapshotMessages = (Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [])
    .filter((message = {}) => Boolean(subSessionMessageIdentity(message)));
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
    sequenceByDomain: {
      ...(current.sequenceByDomain || {}),
      [WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT]: snapshotVersion,
    },
    sequenceByScopeKey: { ...(current.sequenceByScopeKey || {}) },
    revision: Number(current.revision || 0),
    revisionByDomain: { ...(current.revisionByDomain || {}) },
    turnStatuses: isSubSessionTerminalStatus(currentStatus)
      ? (current.turnStatuses || [])
      : Array.isArray(sessionDoc?.turnStatuses)
      ? sessionDoc.turnStatuses
      : (current.turnStatuses || []),
    turnTimings: isSubSessionTerminalStatus(currentStatus)
      ? (current.turnTimings || [])
      : Array.isArray(sessionDoc?.turnTimings)
      ? sessionDoc.turnTimings
      : (current.turnTimings || []),
    eventsById: current.eventsById || {},
    updatedAt: new Date().toISOString(),
  };
  subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
  if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
  return { applied: true, session: registry.sessions[sessionId] };
}

function selectSubSessionMessages(sessionId = "") {
  const id = text(sessionId);
  if (!id) return null;
  return subSessionMessageRegistry.value?.sessions?.[id] || null;
}

  return {
    applySubSessionLifecycleEvent,
    reduceSubSessionMessageEvent: upsertSubSessionEvent,
    reduceSubSessionSnapshot,
    selectSubSessionMessages,
  };
}
