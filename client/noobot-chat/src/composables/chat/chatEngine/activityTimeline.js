/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();
const sequenceOf = (value) => Number(value?.sequence ?? value?.seq ?? 0);

export function isToolActivityLog(value = {}) {
  const type = text(value.event || value.type || value.rawEvent).toLowerCase();
  return type.includes("tool") || type.includes("function");
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
  // Legacy arrays frequently omit both event identity and sequence. Include
  // their observable payload in the migration identity so independently
  // materialized chunks do not collapse merely because both start at index 0.
  const payload = text(value.text || value.output || value?.data?.text || value?.data?.output);
  const timestamp = text(value.timestamp || value.ts);
  return `activity:${type}:${timestamp}:${payload || index + 1}`;
}

export function normalizeRunActivity(value = {}, index = 0) {
  if (!isRunActivityLog(value)) return null;
  const sequence = sequenceOf(value) || index + 1;
  const eventId = text(value.eventId || value.id) || activityKey(value, index);
  return {
    activityId: activityKey(value, index),
    eventId,
    sequence,
    type: text(value.event || value.type || value.rawEvent).toLowerCase() || "activity",
    source: text(value.source || value.category || value?.data?.source),
    status: text(value.status) || "completed",
    text: text(value.text ?? value.output ?? value?.data?.text ?? value?.data?.output),
    timestamp: text(value.timestamp || value.ts),
    log: value,
  };
}

export function reduceActivityTimeline(timeline = [], value = {}) {
  const activity = normalizeRunActivity(value, Array.isArray(timeline) ? timeline.length : 0);
  if (!activity) return Array.isArray(timeline) ? timeline : [];
  return mergeActivityTimelines(timeline, [activity]);
}

export function buildActivityTimelineFromLegacyLogs(logs = []) {
  return (Array.isArray(logs) ? logs : [])
    .map(normalizeRunActivity)
    .filter(Boolean)
    .reduce((timeline, activity) => mergeActivityTimelines(timeline, [activity]), []);
}

export function mergeActivityTimelines(...timelines) {
  const merged = new Map();
  for (const activity of timelines.flat()) {
    if (!activity) continue;
    const normalized = activity.activityId ? activity : normalizeRunActivity(activity);
    if (!normalized) continue;
    const previous = merged.get(normalized.activityId);
    if (!previous || normalized.sequence >= previous.sequence) merged.set(normalized.activityId, normalized);
  }
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
}

export function selectActivityTimeline(message = {}) {
  return Array.isArray(message?.activityTimeline) ? message.activityTimeline : [];
}

export function selectActivityTimelineLogs(message = {}) {
  return selectActivityTimeline(message).map((item) => item.log).filter(Boolean);
}
