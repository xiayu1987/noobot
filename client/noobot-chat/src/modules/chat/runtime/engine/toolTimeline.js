/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_EVENT_TYPE,
  projectMessageEventToolFacets,
  resolveMessageEventSequenceIdentity,
} from "@noobot/shared/message-event-protocol";
import {
  compareTimelineFacts,
  preferTimelineFact,
  SEQUENCE_DOMAIN,
  TIMELINE_AUTHORITY,
} from "./timelineFact.js";

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence || value?.seq || 0);

export const TOOL_TIMELINE_AUTHORITY = TIMELINE_AUTHORITY;
export const TOOL_SEQUENCE_DOMAIN = SEQUENCE_DOMAIN;

function toolCallIdOf(value = {}) {
  return text(value.toolCallId || value.tool_call_id || value.id);
}

function timelineKey(value = {}) {
  const callId = toolCallIdOf(value);
  if (callId) return `call:${callId}`;
  const eventId = text(value.eventId || value.id);
  return eventId ? `event:${eventId}` : "";
}

function isAuthoritativeToolFacet(value = {}) {
  if (text(value?.authority) === TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE) return true;
  const eventType = text(value?.log?.eventType || value?.eventType).toLowerCase();
  return [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(eventType);
}

function facetAuthority(value = {}) {
  return isAuthoritativeToolFacet(value) ? TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE : "";
}

function facetSequenceDomain(value = {}) {
  const explicit = text(value?.sequenceDomain);
  if (explicit) return explicit;
  return isAuthoritativeToolFacet(value) ? TOOL_SEQUENCE_DOMAIN.MESSAGE : "";
}

function normalizeFacetMetadata(value = {}) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value,
    authority: facetAuthority(value),
    sequenceDomain: facetSequenceDomain(value),
  };
}

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
  const sequenceIdentity = resolveMessageEventSequenceIdentity(envelope);
  const eventFact = {
    eventId: text(envelope.eventId),
    sequence: sequenceOf(envelope),
    sequenceScopeId: sequenceIdentity.sequenceScopeId,
    authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
    sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
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
  return next.sort((left, right) => compareTimelineFacts(
    left.call || left.resultEvent,
    right.call || right.resultEvent,
  ));
}

export function selectToolTimelineLogs(message = {}, { completedOnly = false } = {}) {
  const timeline = selectToolTimeline(message);
  const logs = [];
  for (const item of timeline) {
    if (!completedOnly && item.call?.log) {
      logs.push({
        ...item.call.log,
        sequence: sequenceOf(item.call) || sequenceOf(item.call.log),
        sequenceScopeId: text(item.call.sequenceScopeId || item.call.sequenceScope),
        authority: facetAuthority(item.call),
        sequenceDomain: facetSequenceDomain(item.call),
        timelineTimestamp: text(item.call.timestamp || item.call.log?.timestamp || item.call.log?.ts),
      });
    }
    if (item.resultEvent?.log) {
      logs.push({
        ...item.resultEvent.log,
        sequence: sequenceOf(item.resultEvent) || sequenceOf(item.resultEvent.log),
        sequenceScopeId: text(item.resultEvent.sequenceScopeId || item.resultEvent.sequenceScope),
        authority: facetAuthority(item.resultEvent),
        sequenceDomain: facetSequenceDomain(item.resultEvent),
        timelineTimestamp: text(
          item.resultEvent.timestamp || item.resultEvent.log?.timestamp || item.resultEvent.log?.ts,
        ),
      });
    }
  }
  return logs;
}

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

export function selectToolTimeline(message = {}) {
  return Array.isArray(message?.toolTimeline) ? message.toolTimeline : [];
}

export function mergeToolTimelines(...timelines) {
  const merged = new Map();
  for (const candidate of timelines.flat()) {
    const key = text(candidate?.key) || timelineKey(candidate);
    if (!key) continue;
    const previous = merged.get(key) || {};
    const newerFacet = (left, right) => {
      const normalizedLeft = normalizeFacetMetadata(left);
      const normalizedRight = normalizeFacetMetadata(right);
      return preferTimelineFact(normalizedLeft, normalizedRight);
    };
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
  return [...merged.values()].sort((left, right) => compareTimelineFacts(
    left.call || left.resultEvent,
    right.call || right.resultEvent,
  ));
}
