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
} from "./timelineFact";

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

function isToolLog(value = {}) {
  if (text(value.toolCallId || value.tool_call_id)) return true;
  return [value.event, value.type, value.rawEvent, value.eventType]
    .map((item) => text(item).toLowerCase())
    .some((item) => item.includes("tool") || item.includes("function"));
}

function logEventTokens(value = {}) {
  return [value.event, value.type, value.rawEvent, value.eventType]
    .map((item) => text(item).toLowerCase())
    .filter(Boolean);
}

function isAuthoritativeToolFacet(value = {}) {
  if (text(value?.authority) === TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE) return true;
  const eventType = text(value?.log?.eventType || value?.eventType).toLowerCase();
  return [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END].includes(eventType);
}

function facetAuthority(value = {}) {
  return isAuthoritativeToolFacet(value)
    ? TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE
    : TOOL_TIMELINE_AUTHORITY.COMPATIBILITY;
}

function facetSequenceDomain(value = {}) {
  const explicit = text(value?.sequenceDomain);
  if (explicit) return explicit;
  return isAuthoritativeToolFacet(value)
    ? TOOL_SEQUENCE_DOMAIN.MESSAGE
    : TOOL_SEQUENCE_DOMAIN.LEGACY;
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

export function buildToolTimelineFromLegacyLogs(
  logs = [],
  {
    assumeTool = false,
    assumeCompleted = false,
    sequenceDomain = TOOL_SEQUENCE_DOMAIN.LEGACY,
  } = {},
) {
  const timeline = new Map();
  for (const [index, log] of (Array.isArray(logs) ? logs : []).entries()) {
    if (!log) continue;
    const eventTokens = logEventTokens(log);
    const assumeCurrentLogIsTool = typeof assumeTool === "function"
      ? assumeTool(log, index)
      : assumeTool;
    const assumeCurrentLogIsCompleted = typeof assumeCompleted === "function"
      ? assumeCompleted(log, index)
      : assumeCompleted;
    if (!assumeCurrentLogIsTool && !isToolLog(log)) continue;
    const sequence = sequenceOf(log) || index + 1;
    const sourceEventId = text(log.eventId || log.id);
    const toolCallId = toolCallIdOf(log) || (sourceEventId
      ? `legacy-event:${sourceEventId}`
      : `legacy-sequence:${sequence}:${index}`);
    const key = `call:${toolCallId}`;
    const current = timeline.get(key) || { key, toolCallId, tool: text(log.tool || log.toolName || log.name) };
    const eventId = sourceEventId || `legacy:${toolCallId}:${sequence}`;
    const fact = {
      eventId,
      sequence,
      authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
      sequenceDomain: text(log.sequenceDomain) || sequenceDomain,
      timestamp: text(log.timestamp || log.ts),
      log,
    };
    if (Array.isArray(log.attachments) && log.attachments.length) {
      fact.attachments = log.attachments;
    }
    if (Array.isArray(log.writtenFiles) && log.writtenFiles.length) {
      fact.writtenFiles = log.writtenFiles;
    }
    const isErrorEvent = eventTokens.some((item) => item.includes("error")) ||
      text(log.category || log.data?.category).toLowerCase() === "error" ||
      text(log.type || log.data?.type).toLowerCase() === "tool_error";
    const isResultEvent = eventTokens.some((item) =>
      item.includes("result") || item.includes("return") || item.includes("end"));
    if (
      (assumeCurrentLogIsCompleted && !eventTokens.length) ||
      isResultEvent ||
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
  return [...timeline.values()].sort((left, right) => compareTimelineFacts(
    left.call || left.resultEvent,
    right.call || right.resultEvent,
  ));
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

function fillMissingFacet(current = null, legacy = null) {
  if (!current) return legacy ? normalizeFacetMetadata(legacy) : current;
  if (!legacy) return normalizeFacetMetadata(current);
  const normalizedCurrent = normalizeFacetMetadata(current);
  const normalizedLegacy = normalizeFacetMetadata(legacy);
  return {
    ...normalizedLegacy,
    ...normalizedCurrent,
    log: normalizedLegacy.log || normalizedCurrent.log
      ? { ...(normalizedLegacy.log || {}), ...(normalizedCurrent.log || {}) }
      : undefined,
    attachments: normalizedCurrent.attachments?.length
      ? normalizedCurrent.attachments
      : normalizedLegacy.attachments,
    writtenFiles: normalizedCurrent.writtenFiles?.length
      ? normalizedCurrent.writtenFiles
      : normalizedLegacy.writtenFiles,
  };
}

export function fillMissingToolTimelineFacets(timeline = [], legacyTimeline = []) {
  const merged = new Map(
    (Array.isArray(timeline) ? timeline : []).map((item) => [
      text(item?.key) || timelineKey(item),
      { ...item },
    ]).filter(([key]) => key),
  );
  for (const legacyItem of Array.isArray(legacyTimeline) ? legacyTimeline : []) {
    const key = text(legacyItem?.key) || timelineKey(legacyItem);
    if (!key) continue;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...legacyItem,
        key,
        call: legacyItem.call ? normalizeFacetMetadata(legacyItem.call) : legacyItem.call,
        resultEvent: legacyItem.resultEvent
          ? normalizeFacetMetadata(legacyItem.resultEvent)
          : legacyItem.resultEvent,
      });
      continue;
    }
    merged.set(key, {
      ...legacyItem,
      ...current,
      key,
      call: fillMissingFacet(current.call, legacyItem.call),
      resultEvent: fillMissingFacet(current.resultEvent, legacyItem.resultEvent),
      status: current.resultEvent || legacyItem.resultEvent
        ? "completed"
        : current.status || legacyItem.status,
    });
  }
  return [...merged.values()].sort((left, right) => compareTimelineFacts(
    left.call || left.resultEvent,
    right.call || right.resultEvent,
  ));
}
