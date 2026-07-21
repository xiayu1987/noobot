/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PROCESS_COMPAT_LOG_LIMIT,
  PROCESS_EVENT_VERSION,
  ProcessEventType,
  ProcessNodeStatus,
  ProcessStatus,
  normalizeProcessString,
  toProcessSequence,
} from "./protocol";

export function createEmptyProcessState() {
  return {
    version: PROCESS_EVENT_VERSION,
    processesById: {},
    nodesById: {},
    nodeIdsByProcessId: {},
    seenEventIdsByProcessId: {},
  };
}

function ensureProcess(state, processId) {
  const normalizedProcessId = normalizeProcessString(processId);
  if (!normalizedProcessId) return null;
  if (!state.processesById[normalizedProcessId]) {
    state.processesById[normalizedProcessId] = {
      processId: normalizedProcessId,
      status: ProcessStatus.CREATED,
      lastSequence: 0,
      updatedAt: "",
      eventCount: 0,
    };
  }
  if (!state.nodeIdsByProcessId[normalizedProcessId]) state.nodeIdsByProcessId[normalizedProcessId] = [];
  if (!state.seenEventIdsByProcessId[normalizedProcessId]) state.seenEventIdsByProcessId[normalizedProcessId] = [];
  return state.processesById[normalizedProcessId];
}

function rememberSeenEvent(state, processId, eventId) {
  const seen = state.seenEventIdsByProcessId[processId] || [];
  if (!seen.includes(eventId)) {
    seen.push(eventId);
    state.seenEventIdsByProcessId[processId] = seen.slice(-1000);
  }
}

function isDuplicateEvent(state, processId, eventId) {
  if (!eventId) return false;
  return (state.seenEventIdsByProcessId[processId] || []).includes(eventId);
}

function processStatusFromNodeStatus(nodeStatus, previousStatus) {
  if (nodeStatus === ProcessNodeStatus.FAILED) return ProcessStatus.FAILED;
  if (nodeStatus === ProcessNodeStatus.CANCELLED) return ProcessStatus.CANCELLED;
  if (previousStatus === ProcessStatus.FAILED || previousStatus === ProcessStatus.CANCELLED) return previousStatus;
  if (nodeStatus === ProcessNodeStatus.RUNNING || previousStatus === ProcessStatus.CREATED) return ProcessStatus.RUNNING;
  return previousStatus || ProcessStatus.RUNNING;
}

export function hydrateProcessSnapshot(state, snapshot = {}) {
  const processId = normalizeProcessString(snapshot.processId);
  if (!processId) return state;
  const processItem = ensureProcess(state, processId);
  processItem.status = normalizeProcessString(snapshot.status) || processItem.status;
  processItem.lastSequence = Math.max(
    toProcessSequence(processItem.lastSequence, 0),
    toProcessSequence(snapshot.lastSequence, 0),
  );
  processItem.updatedAt = normalizeProcessString(snapshot.updatedAt) || processItem.updatedAt;

  const nodeIds = [];
  for (const node of Array.isArray(snapshot.nodes) ? snapshot.nodes : []) {
    const nodeId = normalizeProcessString(node?.id);
    if (!nodeId) continue;
    state.nodesById[nodeId] = {
      ...(state.nodesById[nodeId] || {}),
      ...node,
      id: nodeId,
      processId,
    };
    nodeIds.push(nodeId);
  }
  state.nodeIdsByProcessId[processId] = Array.from(new Set([
    ...(state.nodeIdsByProcessId[processId] || []),
    ...nodeIds,
  ]));
  return state;
}

export function applyProcessEvent(state, eventItem = {}) {
  const processId = normalizeProcessString(eventItem.processId || eventItem?.meta?.processId);
  if (!processId) return state;
  const processItem = ensureProcess(state, processId);
  const eventId = normalizeProcessString(eventItem.eventId || eventItem?.meta?.eventId);
  if (isDuplicateEvent(state, processId, eventId)) return state;

  const sequence = toProcessSequence(eventItem.sequence ?? eventItem?.meta?.sequence, 0);
  const eventType = normalizeProcessString(eventItem.type);
  const node = eventItem?.payload?.node;
  if (node?.id) {
    const nodeId = normalizeProcessString(node.id);
    const previousNode = state.nodesById[nodeId] || {};
    const nextStatus = normalizeProcessString(node.status) || previousNode.status || ProcessNodeStatus.RUNNING;
    state.nodesById[nodeId] = {
      ...previousNode,
      ...node,
      id: nodeId,
      processId,
      status: nextStatus,
      updatedAt: normalizeProcessString(eventItem.timestamp) || previousNode.updatedAt || "",
    };
    if (!(state.nodeIdsByProcessId[processId] || []).includes(nodeId)) {
      state.nodeIdsByProcessId[processId] = [...(state.nodeIdsByProcessId[processId] || []), nodeId];
    }
    processItem.status = processStatusFromNodeStatus(nextStatus, processItem.status);
  }

  if (eventType === ProcessEventType.PROCESS_FINISHED) {
    processItem.status = normalizeProcessString(eventItem?.payload?.status) || ProcessStatus.SUCCEEDED;
  } else if (eventType === ProcessEventType.PROCESS_STARTED && processItem.status === ProcessStatus.CREATED) {
    processItem.status = ProcessStatus.RUNNING;
  }
  processItem.lastSequence = Math.max(toProcessSequence(processItem.lastSequence, 0), sequence);
  processItem.updatedAt = normalizeProcessString(eventItem.timestamp) || processItem.updatedAt;
  processItem.eventCount = Number(processItem.eventCount || 0) + 1;
  rememberSeenEvent(state, processId, eventId);
  return state;
}

export function applyProcessEvents(state, events = []) {
  const sortedEvents = [...(Array.isArray(events) ? events : [])].sort((left, right) => {
    const leftSequence = toProcessSequence(left?.sequence ?? left?.meta?.sequence, 0);
    const rightSequence = toProcessSequence(right?.sequence ?? right?.meta?.sequence, 0);
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    return normalizeProcessString(left?.timestamp).localeCompare(normalizeProcessString(right?.timestamp));
  });
  for (const eventItem of sortedEvents) applyProcessEvent(state, eventItem);
  return state;
}

export function selectProcessSnapshot(state, processId = "") {
  const normalizedProcessId = normalizeProcessString(processId);
  const processItem = state.processesById[normalizedProcessId];
  if (!processItem) return null;
  const nodes = (state.nodeIdsByProcessId[normalizedProcessId] || [])
    .map((nodeId) => state.nodesById[nodeId])
    .filter(Boolean);
  return {
    version: PROCESS_EVENT_VERSION,
    processId: normalizedProcessId,
    status: processItem.status,
    lastSequence: toProcessSequence(processItem.lastSequence, 0),
    updatedAt: processItem.updatedAt,
    nodes,
    meta: { eventCount: Number(processItem.eventCount || 0) },
  };
}

export function selectProcessCompatView(state, processId = {}) {
  const normalizedProcessId = normalizeProcessString(processId);
  const snapshot = selectProcessSnapshot(state, normalizedProcessId);
  if (!snapshot) return { realtimeLogs: [], completedToolLogs: [], executionLogTotal: 0, lastSequence: 0 };
  const logs = snapshot.nodes.map((node) => node?.log || node?.payload?.log).filter(Boolean);
  return {
    realtimeLogs: logs.slice(-PROCESS_COMPAT_LOG_LIMIT),
    completedToolLogs: logs,
    executionLogTotal: logs.length,
    lastSequence: snapshot.lastSequence,
    status: snapshot.status,
  };
}
