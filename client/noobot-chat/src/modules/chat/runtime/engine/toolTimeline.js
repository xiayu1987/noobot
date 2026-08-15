/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  reduceCanonicalToolTimeline,
  resolveCanonicalToolTimelineStatus,
} from "@noobot/event-protocol/tool-timeline";
import {
  compareTimelineFacts,
  preferTimelineFact,
  SEQUENCE_DOMAIN,
  TIMELINE_AUTHORITY,
} from "./timelineFact.js";
import { parseTaskCheckReceipt } from "@noobot/context-protocol/task-check-receipt";
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { projectToolOperationSummary } from "@noobot/event-protocol/tool-presentation";
import { isToolResultFailure } from "../../model/toolLogFormatting.js";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence || value?.seq || 0);

function canonicalAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).flatMap((attachment) => {
    const normalized =
      attachment && typeof attachment === "object"
        ? {
            ...attachment,
            attachmentId: attachment?.attachmentId || attachment?.identity?.attachmentId,
            sessionId: attachment?.sessionId || attachment?.identity?.sessionId,
            attachmentSource:
              attachment?.attachmentSource || attachment?.identity?.attachmentSource,
          }
        : null;
    if (!normalized) return [];
    try {
      projectAttachmentIdentity(normalized);
      return [normalized];
    } catch {
      return [];
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

function projectToolTimelineLog({ entry = {}, facet = {}, kind = "" } = {}) {
  if (!facet || typeof facet !== "object") return null;
  const isCall = kind === "call";
  const canonicalDetail = isCall ? entry?.args : entry?.result;
  const persistedSummary = text(facet.summary);
  const summary =
    persistedSummary ||
    projectToolOperationSummary(entry.tool, canonicalDetail, { result: !isCall });
  const failed =
    !isCall &&
    isToolResultFailure({
      success: entry.success,
      status: entry.status,
      result: canonicalDetail,
    });
  return {
    eventId: text(facet.eventId),
    event: isCall ? "tool_call" : "tool_result",
    type: isCall ? "tool_call" : "tool_result",
    eventType: isCall ? MESSAGE_EVENT_TYPE.TOOL_CALL_START : MESSAGE_EVENT_TYPE.TOOL_CALL_END,
    category: "tool",
    toolCallId: text(entry.toolCallId),
    tool: text(entry.tool),
    riskLevel: normalizeSecurityRiskLevel(entry.riskLevel),
    text: summary,
    ...(isCall ? { args: canonicalDetail } : { result: canonicalDetail }),
    ...(isCall
      ? {}
      : {
          success: !failed,
          status: failed ? "failed" : "completed",
        }),
    presentation: {
      tone: isCall ? "primary" : failed ? "error" : "success",
    },
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
  return reduceCanonicalToolTimeline(timeline, envelope).sort((left, right) =>
    compareTimelineFacts(left.call || left.resultEvent, right.call || right.resultEvent),
  );
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
    )
      continue;
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
    const mergedEntry = {
      ...previous,
      ...candidate,
      key,
      call:
        previous.call && candidate?.call
          ? newerFacet(previous.call, candidate.call)
          : candidate?.call || previous.call,
      resultEvent:
        previous.resultEvent && candidate?.resultEvent
          ? newerFacet(previous.resultEvent, candidate.resultEvent)
          : candidate?.resultEvent || previous.resultEvent,
    };
    merged.set(key, {
      ...mergedEntry,
      status: resolveCanonicalToolTimelineStatus(mergedEntry),
    });
  }
  return [...merged.values()].sort((left, right) =>
    compareTimelineFacts(left.call || left.resultEvent, right.call || right.resultEvent),
  );
}
