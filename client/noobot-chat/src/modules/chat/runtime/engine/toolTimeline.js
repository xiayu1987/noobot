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
import { parseTaskCheckReceipt } from "@noobot/context-protocol/task-check-receipt";
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence || value?.seq || 0);

function canonicalAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachment) => {
    try {
      projectAttachmentIdentity(attachment);
      return true;
    } catch {
      return false;
    }
  });
}

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

function stringifyToolDetail(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "").trim();
  }
}

function parseStructuredValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compactSummaryValue(value, maxLength = 96) {
  const normalized = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function fileSummary(value = {}) {
  const candidate = value.filePath || value.path || value.fileName || value.resolvedPath || "";
  return compactSummaryValue(candidate);
}

export function buildToolOperationSummary(tool = "", detail, { result = false } = {}) {
  const toolName = text(tool) || "tool";
  const value = parseStructuredValue(detail);
  let subject = "";
  if (["write_file", "read_file"].includes(toolName)) {
    subject = fileSummary(value);
  } else if (toolName === "patch_file") {
    const changedFiles = Array.isArray(value.changedFiles) ? value.changedFiles : [];
    subject = compactSummaryValue(changedFiles[0] || value.root || "");
  } else if (["execute_script", "execute_command"].includes(toolName)) {
    subject = compactSummaryValue(value.command || value.script || value.stdout || "");
  } else if (toolName === "search") {
    const matchCount = Array.isArray(value.matches) ? `${value.matches.length} matches` : "";
    subject = compactSummaryValue([value.query, value.path || value.source, matchCount].filter(Boolean).join(" · "));
  } else if (toolName === "list_skills") {
    const itemCount = Array.isArray(value.items) ? `${value.items.length} items` : "";
    subject = compactSummaryValue(value.parentSkill || itemCount);
  } else if (toolName === "user_interaction") {
    subject = compactSummaryValue(value.content || value.message || "");
  } else {
    subject = fileSummary(value) || compactSummaryValue(
      value.command || value.query || value.content || value.message || value.stdout || "",
    );
  }
  if (!subject && result && typeof detail === "string" && !Object.keys(value).length) {
    const rawResult = compactSummaryValue(detail);
    if (rawResult && rawResult !== toolName) subject = rawResult;
  }
  return subject ? `${toolName} · ${subject}` : toolName;
}

function projectToolTimelineLog({ entry = {}, facet = {}, kind = "" } = {}) {
  if (!facet || typeof facet !== "object") return null;
  const isCall = kind === "call";
  const canonicalDetail = isCall ? entry?.args : entry?.result;
  const summary = text(facet.summary) || buildToolOperationSummary(entry.tool, canonicalDetail, { result: !isCall });
  return {
    eventId: text(facet.eventId),
    event: isCall ? "tool_call" : "tool_result",
    type: isCall ? "tool_call" : "tool_result",
    eventType: isCall ? MESSAGE_EVENT_TYPE.TOOL_CALL_START : MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    category: "tool",
    toolCallId: text(entry.toolCallId),
    tool: text(entry.tool),
    text: summary,
    ...(isCall ? { args: canonicalDetail } : { result: canonicalDetail }),
    ...(isCall ? {} : {
      success: entry.success !== false,
      status: entry.success === false ? "failed" : "completed",
    }),
    ...(Array.isArray(facet.attachments) && facet.attachments.length
      ? { attachments: facet.attachments }
      : {}),
    detailText: stringifyToolDetail(canonicalDetail),
    sequence: sequenceOf(facet),
    sequenceScopeId: text(facet.sequenceScopeId),
    authority: facetAuthority(facet),
    sequenceDomain: facetSequenceDomain(facet),
    timelineTimestamp: text(facet.timestamp),
  };
}

export function reduceToolTimeline(timeline = [], envelope = {}) {
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
    sessionId: text(envelope.sessionId),
    dialogProcessId: text(envelope.dialogProcessId),
    turnScopeId: text(envelope.turnScopeId),
    ...(Array.isArray(envelope?.attachments) && envelope.attachments.length
      ? { attachments: envelope.attachments }
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
    if (!completedOnly && item.call) {
      logs.push(projectToolTimelineLog({ entry: item, facet: item.call, kind: "call" }));
    }
    if (item.resultEvent) {
      logs.push(projectToolTimelineLog({ entry: item, facet: item.resultEvent, kind: "result" }));
    }
  }
  return logs.sort(compareTimelineFacts);
}

export function selectCompletedToolArtifacts(message = {}) {
  const completedEntries = selectToolTimeline(message).filter((item) => item?.resultEvent);
  const logs = completedEntries
    .map((item) => projectToolTimelineLog({ entry: item, facet: item.resultEvent, kind: "result" }))
    .filter(Boolean);
  return {
    resultCount: completedEntries.length,
    logs,
    attachments: completedEntries.flatMap((item) => {
      const eventAttachments = item?.resultEvent?.attachments;
      return canonicalAttachments(eventAttachments);
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

export function selectLatestTaskCheckReceipt(message = {}) {
  return selectTaskCheckReceipts(message).at(-1) || null;
}

export function selectTaskCheckReceipts(message = {}) {
  const receipts = [];
  for (const entry of selectToolTimeline(message)) {
    if (text(entry?.tool) !== "task_check" || !entry?.resultEvent) continue;
    if (typeof entry.result !== "string") continue;
    let payload;
    try {
      payload = JSON.parse(entry.result);
    } catch {
      continue;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.toolName !== "task_check" ||
      payload.protocolVersion !== 1
    ) continue;
    try {
      const receipt = parseTaskCheckReceipt(payload.summary);
      receipts.push({
        ...receipt,
        timestamp: text(entry.resultEvent?.timestamp || entry.call?.timestamp),
      });
    } catch {
      continue;
    }
  }
  return receipts;
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
