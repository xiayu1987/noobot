/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createWeakArrayIndex, upsertOrderedFact } from "@noobot/timeline-runtime";
import {
  compareTimelineFacts,
  preferTimelineFact,
  SEQUENCE_DOMAIN,
  TIMELINE_AUTHORITY,
} from "./timelineFact.js";

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence ?? value?.seq ?? 0);
const activityTimelineIndex = createWeakArrayIndex({ keyOf: (activity) => activity?.activityId });

export function isToolActivityLog(value = {}) {
  const eventTokens = [value.event, value.type, value.rawEvent, value.eventType]
    .map((item) => text(item).toLowerCase())
    .filter(Boolean);
  const toolCallId = text(value.toolCallId || value.tool_call_id);
  return Boolean(
    toolCallId || eventTokens.some((item) => item.includes("tool") || item.includes("function")),
  );
}

export function isRunActivityLog(value = {}) {
  if (!value || isToolActivityLog(value)) return false;
  const type = text(value.event || value.type || value.rawEvent).toLowerCase();
  return Boolean(type || text(value.text || value.output || value?.data?.text || value?.data?.output));
}

function activityKey(value = {}, index = 0) {
  const eventId = text(value.eventId || value.id);
  if (eventId) return `event:${eventId}`;
  const sequence = sequenceOf(value);
  const type = text(value.event || value.type || value.rawEvent).toLowerCase() || "activity";
  if (sequence) return `activity:${type}:${sequence}`;
  const payload = text(value.text || value.output || value?.data?.text || value?.data?.output);
  const timestamp = text(value.timestamp || value.ts);
  return `activity:${type}:${timestamp}:${payload || index + 1}`;
}

export function normalizeRunActivity(value = {}, index = 0) {
  if (!isRunActivityLog(value)) return null;
  if (text(value.authority) !== TIMELINE_AUTHORITY.AUTHORITATIVE) return null;
  if (text(value.sequenceDomain) !== SEQUENCE_DOMAIN.MESSAGE) return null;
  const sequence = sequenceOf(value) || index + 1;
  const eventId = text(value.eventId || value.id) || activityKey(value, index);
  return {
    activityId: activityKey(value, index),
    eventId,
    event: text(value.event || value.type || value.rawEvent).toLowerCase() || "activity",
    sequence,
    sequenceScopeId: text(value.sequenceScopeId || value.sequenceScope),
    authority: TIMELINE_AUTHORITY.AUTHORITATIVE,
    sequenceDomain: SEQUENCE_DOMAIN.MESSAGE,
    type: text(value.event || value.type || value.rawEvent).toLowerCase() || "activity",
    activityKind: text(value.activityKind),
    source: text(value.source || value.category || value?.data?.source),
    status: text(value.status) || "completed",
    text: text(value.text ?? value.output ?? value?.data?.text ?? value?.data?.output),
    output: text(value.output ?? value.text ?? value?.data?.output ?? value?.data?.text),
    purpose: text(value.purpose),
    pluginFlow: text(value.pluginFlow),
    chain: text(value.chain),
    messageId: text(value.messageId),
    presentationMessageId: text(value.presentationMessageId),
    sessionId: text(value.sessionId),
    turnScopeId: text(value.turnScopeId),
    timestamp: text(value.timestamp || value.ts),
    log: value,
  };
}

export function reduceActivityTimeline(timeline = [], value = {}) {
  const activity = normalizeRunActivity(value, Array.isArray(timeline) ? timeline.length : 0);
  if (!activity) return Array.isArray(timeline) ? timeline : [];
  const target = Array.isArray(timeline) ? timeline : [];
  return upsertOrderedFact({
    values: target,
    fact: activity,
    key: activity.activityId,
    index: activityTimelineIndex.indexFor(target),
    compare: compareTimelineFacts,
    merge: preferTimelineFact,
    recordInsertion: activityTimelineIndex.recordInsertion,
  });
}

export function mergeActivityTimelines(...timelines) {
  const merged = new Map();
  for (const activity of timelines.flat()) {
    if (!activity) continue;
    const normalized = activity.activityId ? activity : normalizeRunActivity(activity);
    if (!normalized) continue;
    const previous = merged.get(normalized.activityId);
    merged.set(normalized.activityId, preferTimelineFact(previous, normalized));
  }
  return [...merged.values()].sort(compareTimelineFacts);
}

export function selectActivityTimeline(message = {}) {
  return Array.isArray(message?.activityTimeline) ? message.activityTimeline : [];
}

export function selectActivityTimelineLogs(message = {}) {
  return selectActivityTimeline(message)
    .filter((item) => isRunActivityLog(item))
    .map((item) => ({
      ...item,
      event: text(item.event || item.type || item.activityKind),
      type: text(item.type || item.event || item.activityKind),
      sequence: sequenceOf(item),
      sequenceScopeId: text(item.sequenceScopeId),
      authority: text(item.authority),
      sequenceDomain: text(item.sequenceDomain),
      timelineTimestamp: text(item.timestamp || item.ts),
    }));
}

const activityEventOf = (item = {}) =>
  text(item.event || item.type || item.activityKind).toLowerCase();

export function selectLatestAnalysisActivities(message = {}) {
  const timeline = selectActivityTimeline(message);
  let latestGuidance = null;
  let latestModelAnalysis = null;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    const event = activityEventOf(item);
    if (
      !latestGuidance &&
      (event === "guidance_analysis_response" || event === "guidance_analysis")
    ) latestGuidance = item;
    if (!latestModelAnalysis && event === "main_model_content") {
      latestModelAnalysis = item;
    }
    if (latestGuidance && latestModelAnalysis) break;
  }
  return {
    activityTimelineCount: timeline.length,
    latestGuidance,
    latestModelAnalysis,
  };
}
