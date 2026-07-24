/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_TYPE, projectMessageEventToolFacets } from "@noobot/shared/message-event-protocol";

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence || value?.seq || 0);

function toolCallIdOf(value = {}) {
  return text(value.toolCallId || value.tool_call_id || value.id);
}

function timelineKey(value = {}) {
  const callId = toolCallIdOf(value);
  if (callId) return `call:${callId}`;
  const eventId = text(value.eventId || value.id);
  return eventId ? `event:${eventId}` : "";
}

/**
 * Adds an authoritative tool envelope to the canonical per-turn timeline.
 * A call and its result occupy one entry, keyed by toolCallId. Event identity is
 * retained on each facet so duplicate transports cannot create duplicate UI facts.
 */
export function reduceToolTimeline(timeline = [], envelope = {}, displayLog = null) {
  if (![MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(envelope?.eventType)) {
    return Array.isArray(timeline) ? timeline : [];
  }
  const key = timelineKey(envelope);
  if (!key) return Array.isArray(timeline) ? timeline : [];
  const next = Array.isArray(timeline) ? timeline.map((item) => ({ ...item })) : [];
  const index = next.findIndex((item) => item.key === key);
  const current = index >= 0 ? next[index] : { key, toolCallId: toolCallIdOf(envelope) };
  const { toolCall, toolResult } = projectMessageEventToolFacets(envelope);
  const eventFact = {
    eventId: text(envelope.eventId),
    sequence: sequenceOf(envelope),
    timestamp: text(envelope.timestamp),
    log: displayLog || undefined,
    ...(Array.isArray(envelope?.attachments) && envelope.attachments.length
      ? { attachments: envelope.attachments }
      : Array.isArray(displayLog?.attachments) && displayLog.attachments.length
        ? { attachments: displayLog.attachments }
        : {}),
    ...(Array.isArray(envelope?.writtenFiles) && envelope.writtenFiles.length
      ? { writtenFiles: envelope.writtenFiles }
      : Array.isArray(displayLog?.writtenFiles) && displayLog.writtenFiles.length
        ? { writtenFiles: displayLog.writtenFiles }
        : {}),
  };
  const updated = envelope.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START
    ? { ...current, tool: text(envelope.tool || toolCall?.name || current.tool), args: toolCall?.args ?? envelope.args ?? current.args, call: eventFact, status: current.result ? "completed" : "running" }
    : { ...current, tool: text(envelope.tool || toolResult?.name || current.tool), result: toolResult?.output ?? envelope.result, success: toolResult?.success ?? envelope.success !== false, resultEvent: eventFact, status: "completed" };
  if (index >= 0) next[index] = updated;
  else next.push(updated);
  return next.sort((left, right) => {
    const leftSequence = Number(left.call?.sequence || left.resultEvent?.sequence || 0);
    const rightSequence = Number(right.call?.sequence || right.resultEvent?.sequence || 0);
    return leftSequence - rightSequence;
  });
}

/** Compatibility selector. New UI code reads the timeline; old components may
 * consume the same display-log shape without owning another mutable array. */
export function selectToolTimelineLogs(message = {}, { completedOnly = false } = {}) {
  const timeline = selectToolTimeline(message);
  const logs = [];
  for (const item of timeline) {
    if (!completedOnly && item.call?.log) logs.push(item.call.log);
    if (item.resultEvent?.log) logs.push(item.resultEvent.log);
  }
  return logs;
}

/** Canonical projection for assets produced by completed tool executions. */
export function selectCompletedToolArtifacts(message = {}) {
  const completedEntries = selectToolTimeline(message).filter((item) => item?.resultEvent);
  const logs = completedEntries
    .map((item) => item.resultEvent?.log)
    .filter(Boolean);
  return {
    resultCount: completedEntries.length,
    logs,
    attachments: completedEntries.flatMap((item) => {
      const eventAttachments = item?.resultEvent?.attachments;
      if (Array.isArray(eventAttachments) && eventAttachments.length) return eventAttachments;
      const logAttachments = item?.resultEvent?.log?.attachments;
      return Array.isArray(logAttachments) ? logAttachments : [];
    }),
    writtenFiles: completedEntries.flatMap((item) => {
      const eventWrittenFiles = item?.resultEvent?.writtenFiles;
      if (Array.isArray(eventWrittenFiles) && eventWrittenFiles.length) return eventWrittenFiles;
      const logWrittenFiles = item?.resultEvent?.log?.writtenFiles;
      return Array.isArray(logWrittenFiles) ? logWrittenFiles : [];
    }),
  };
}

export function countCompletedToolAttachments(message = {}) {
  return selectCompletedToolArtifacts(message).attachments.length;
}

export function selectToolTimelineCount(message = {}) {
  return selectToolTimeline(message).length;
}

export function hasToolTimeline(message = {}) {
  return Array.isArray(message?.toolTimeline) && message.toolTimeline.length > 0;
}

/** Normalize legacy history/done logs once at the projection boundary. */
export function buildToolTimelineFromLegacyLogs(
  logs = [],
  { assumeTool = false, assumeCompleted = false } = {},
) {
  const timeline = new Map();
  for (const [index, log] of (Array.isArray(logs) ? logs : []).entries()) {
    if (!log) continue;
    const legacyEventType = text(log.event || log.type || log.rawEvent).toLowerCase();
    const assumeCurrentLogIsTool = typeof assumeTool === "function"
      ? assumeTool(log, index)
      : assumeTool;
    const assumeCurrentLogIsCompleted = typeof assumeCompleted === "function"
      ? assumeCompleted(log, index)
      : assumeCompleted;
    if (!assumeCurrentLogIsTool && !legacyEventType.includes("tool") && !legacyEventType.includes("function")) continue;
    const sequence = sequenceOf(log) || index + 1;
    const sourceEventId = text(log.eventId || log.id);
    const toolCallId = toolCallIdOf(log) || (sourceEventId
      ? `legacy-event:${sourceEventId}`
      : `legacy-sequence:${sequence}:${index}`);
    const key = `call:${toolCallId}`;
    const current = timeline.get(key) || { key, toolCallId, tool: text(log.tool || log.toolName || log.name) };
    const eventId = sourceEventId || `legacy:${toolCallId}:${sequence}`;
    const fact = { eventId, sequence, timestamp: text(log.timestamp || log.ts), log };
    if (Array.isArray(log.attachments) && log.attachments.length) {
      fact.attachments = log.attachments;
    }
    if (Array.isArray(log.writtenFiles) && log.writtenFiles.length) {
      fact.writtenFiles = log.writtenFiles;
    }
    const eventType = text(log.event || log.type).toLowerCase();
    const isErrorEvent = eventType.includes("error") ||
      text(log.category || log.data?.category).toLowerCase() === "error" ||
      text(log.type || log.data?.type).toLowerCase() === "tool_error";
    if (
      (assumeCurrentLogIsCompleted && !eventType) ||
      eventType.includes("result") ||
      eventType.includes("return") ||
      eventType.includes("end") ||
      isErrorEvent
    ) {
      const result = log.output ?? log.result ?? log.data?.output ?? log.text;
      const existingResultText = text(
        current.resultEvent?.log?.text ?? current.resultEvent?.log?.output ?? current.result,
      );
      const incomingResultText = text(log.text ?? log.output ?? result);
      const keepExistingUnversionedResult = Boolean(
        current.resultEvent &&
        !sourceEventId &&
        sequenceOf(log) === 0 &&
        (existingResultText || !incomingResultText),
      );
      if (!keepExistingUnversionedResult) {
        current.result = result;
        current.success = !isErrorEvent && log.success !== false;
        current.resultEvent = fact;
      }
      current.status = "completed";
    } else {
      current.args = log.args ?? log.arguments ?? log.data?.args;
      current.call = fact;
      current.status = current.resultEvent ? "completed" : "running";
    }
    timeline.set(key, current);
  }
  return [...timeline.values()].sort((left, right) =>
    Number(left.call?.sequence || left.resultEvent?.sequence || 0) -
    Number(right.call?.sequence || right.resultEvent?.sequence || 0));
}

/**
 * Projection selector with the only supported legacy-document boundary.
 * Process fields represent an older complete projection when populated; an
 * empty Process projection must not hide replayed message logs. Runtime code
 * never writes the converted value back to either legacy array.
 */
export function selectToolTimeline(message = {}) {
  return Array.isArray(message?.toolTimeline) ? message.toolTimeline : [];
}

/** Deterministic snapshot/live merge. Newer facets win independently so an old
 * snapshot can fill a missing call without erasing a live result. */
export function mergeToolTimelines(...timelines) {
  const merged = new Map();
  for (const candidate of timelines.flat()) {
    const key = text(candidate?.key) || timelineKey(candidate);
    if (!key) continue;
    const previous = merged.get(key) || {};
    const newerFacet = (left, right) => sequenceOf(right) >= sequenceOf(left) ? right : left;
    merged.set(key, {
      ...previous,
      ...candidate,
      key,
      call: previous.call && candidate?.call
        ? newerFacet(previous.call, candidate.call)
        : candidate?.call || previous.call,
      resultEvent: previous.resultEvent && candidate?.resultEvent
        ? newerFacet(previous.resultEvent, candidate.resultEvent)
        : candidate?.resultEvent || previous.resultEvent,
      status: previous.resultEvent || candidate?.resultEvent ? "completed" : candidate?.status || previous.status,
    });
  }
  return [...merged.values()].sort((left, right) => {
    const firstSequence = (item) => Number(item.call?.sequence || item.resultEvent?.sequence || 0);
    return firstSequence(left) - firstSequence(right);
  });
}
