/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../composables/infra/timeFields";
import {
  PROCESS_EVENT_VERSION,
  ProcessEventSource,
  ProcessEventType,
  ProcessNodeStatus,
  ProcessStatus,
  buildProcessEventId,
  normalizeProcessString,
  resolveExplicitProcessTimestamp,
  resolveProcessId,
  resolveProcessTimestamp,
  toProcessSequence,
} from "./protocol";
import {
  normalizeExecutionLogForRealtime,
  sanitizeExecutionLogForDisplay,
} from "../../composables/chat/chatEngine/utils";

function stableNodeId({
  processId = "",
  logItem = {},
  index = 0,
  source = ProcessEventSource.UNKNOWN,
  sequence = 0,
}) {
  const toolCallId = normalizeProcessString(logItem.toolCallId || logItem.tool_call_id);
  if (toolCallId) return `${processId}:tool:${toolCallId}:${normalizeProcessString(logItem.event || logItem.type) || "event"}`;
  const resolvedSequence = toProcessSequence(sequence || logItem.sequence || logItem.seq, 0);
  if (resolvedSequence > 0) return `${processId}:seq:${resolvedSequence}`;
  return `${processId}:${source}:${normalizeProcessString(logItem.event || logItem.type) || "event"}:${index}`;
}


function resolveRawLogExplicitTimestamp(rawLog = {}) {
  const data = rawLog?.data && typeof rawLog.data === "object" ? rawLog.data : {};
  return resolveExplicitProcessTimestamp({
    timestamp: data?.timestamp || rawLog?.timestamp,
    ts: data?.ts || rawLog?.ts,
    createdAt: data?.createdAt || rawLog?.createdAt,
    updatedAt: data?.updatedAt || rawLog?.updatedAt,
  });
}

function statusFromLog(logItem = {}, terminal = false) {
  const status = normalizeProcessString(logItem.status).toLowerCase();
  const event = normalizeProcessString(logItem.event || logItem.type).toLowerCase();
  if (["failed", "error", "errored"].includes(status) || event.includes("error")) return ProcessNodeStatus.FAILED;
  if (["cancelled", "canceled"].includes(status) || event.includes("cancel")) return ProcessNodeStatus.CANCELLED;
  if (status === "skipped") return ProcessNodeStatus.SKIPPED;
  if (event === "tool_result" || event.endsWith("_result") || terminal) return ProcessNodeStatus.SUCCEEDED;
  return ProcessNodeStatus.RUNNING;
}

export function normalizeProcessLog(rawLog = {}) {
  const normalizedLog = normalizeExecutionLogForRealtime(rawLog || {});
  return sanitizeExecutionLogForDisplay(normalizedLog);
}

export function createProcessEventFromLog(rawLog = {}, options = {}) {
  const logItem = normalizeProcessLog(rawLog);
  if (!logItem) return null;
  const source = options.source || ProcessEventSource.UNKNOWN;
  const processId = resolveProcessId({ ...logItem, ...options });
  if (!processId) return null;
  const sequence = toProcessSequence(
    logItem.sequence ?? logItem.seq ?? options.sequence,
    options.fallbackSequence,
  );
  // normalizeProcessLog fills a missing ts with nowMs() for display.
  // Do not use that generated timestamp as part of eventId, otherwise two
  // equivalent logs created in different milliseconds dedupe as different events.
  const explicitTimestamp = resolveRawLogExplicitTimestamp(rawLog);
  const timestamp = resolveProcessTimestamp(logItem);
  const nodeId = normalizeProcessString(options.nodeId) || stableNodeId({
    processId,
    logItem,
    index: options.index || 0,
    source,
    sequence,
  });
  const type = options.terminal ? ProcessEventType.NODE_FINISHED : ProcessEventType.NODE_UPSERTED;
  const eventId = normalizeProcessString(logItem.eventId || logItem.id || options.eventId) || buildProcessEventId({
    source,
    type,
    processId,
    nodeId,
    sequence,
    timestamp: explicitTimestamp,
    event: logItem.event || logItem.type,
    text: logItem.text,
  });
  return {
    version: PROCESS_EVENT_VERSION,
    eventId,
    sequence,
    processId,
    timestamp,
    type,
    meta: {
      eventId,
      sequence,
      version: PROCESS_EVENT_VERSION,
      processId,
      timestamp,
      source,
      sessionId: normalizeProcessString(logItem.sessionId || options.sessionId),
      dialogProcessId: normalizeProcessString(logItem.dialogProcessId || options.dialogProcessId || processId),
      parentDialogProcessId: normalizeProcessString(logItem.parentDialogProcessId || options.parentDialogProcessId),
      toolCallId: normalizeProcessString(logItem.toolCallId || logItem.tool_call_id || options.toolCallId),
    },
    payload: {
      node: {
        id: nodeId,
        processId,
        parentId: normalizeProcessString(options.parentNodeId),
        status: statusFromLog(logItem, options.terminal),
        title: normalizeProcessString(logItem.title || logItem.event || logItem.type || "execution_step"),
        summary: normalizeProcessString(logItem.text),
        log: logItem,
        startedAt: timestamp,
        endedAt: options.terminal ? timestamp : "",
      },
      log: logItem,
      raw: rawLog,
    },
  };
}

export function createProcessEventsFromLogs(logs = [], options = {}) {
  const baseSequence = toProcessSequence(options.baseSequence, 0);
  return (Array.isArray(logs) ? logs : [])
    .map((logItem, index) => createProcessEventFromLog(logItem, {
      ...options,
      index,
      fallbackSequence: baseSequence + index + 1,
    }))
    .filter(Boolean);
}

export function createProcessEventsFromStreamEvent({ event = "", data = {}, source = ProcessEventSource.STREAM } = {}) {
  return createProcessEventsFromLogs([{ ...(data || {}), event: data?.event || event }], {
    source,
    sequence: data?.sequence ?? data?.seq,
    dialogProcessId: data?.dialogProcessId,
    sessionId: data?.sessionId,
  });
}

export function createProcessEventsFromDonePayload(data = {}, options = {}) {
  const executionSummarySteps = Array.isArray(data?.executionSummary?.steps) ? data.executionSummary.steps : [];
  const executionLogs = executionSummarySteps.length ? executionSummarySteps : (Array.isArray(data?.executionLogs) ? data.executionLogs : []);
  return createProcessEventsFromLogs(executionLogs, {
    source: options.source || ProcessEventSource.STREAM,
    terminal: true,
    baseSequence: data?.sequence ?? data?.seq ?? options.baseSequence,
    dialogProcessId: data?.dialogProcessId,
    sessionId: data?.sessionId,
  });
}

export function createProcessSnapshotFromLogs({ processId = "", logs = [], status = ProcessStatus.SUCCEEDED, source = ProcessEventSource.SNAPSHOT } = {}) {
  const events = createProcessEventsFromLogs(logs, { source, dialogProcessId: processId });
  const nodes = events.map((eventItem) => eventItem.payload.node);
  const lastSequence = events.reduce((maxSequence, eventItem) => Math.max(maxSequence, toProcessSequence(eventItem.sequence, 0)), 0);
  return {
    version: PROCESS_EVENT_VERSION,
    processId: normalizeProcessString(processId) || resolveProcessId(nodes[0] || {}),
    status,
    lastSequence,
    updatedAt: nodes.length ? nodes[nodes.length - 1].startedAt : nowIso(),
    nodes,
    meta: { source, version: PROCESS_EVENT_VERSION },
  };
}
