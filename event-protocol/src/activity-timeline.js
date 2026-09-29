/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { EVENT_FAMILY, validateProtocolEvent } from "./event-registry.js";
import { MESSAGE_EVENT_TYPE } from "./message-event.js";
import { text } from "./normalize.js";

// Activity fact kinds. A standalone activity event carries the complete text of one
// activity; ACTIVITY_DELTA carries an incremental fragment of the same activity.
const ACTIVITY_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MODEL_ANALYSIS_DELTA]),
);

const ACTIVITY_WIRE_EVENT_TYPES = Object.freeze(
  new Set([...ACTIVITY_EVENT_TYPES, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA]),
);

const ACTIVITY_TIMELINE_FACT_FIELDS = Object.freeze(
  new Set([
    "eventId",
    "eventType",
    "text",
    "activityKind",
    "purpose",
    "pluginFlow",
    "chain",
    "relayCorrelationId",
    "sequence",
    "sequenceScopeId",
    "sequenceDomain",
    "authority",
    "timestamp",
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "messageId",
    "presentationMessageId",
    "activityId",
  ]),
);

export function isCanonicalActivityMessageEvent(envelope = {}) {
  const validation = validateProtocolEvent(envelope);
  return Boolean(
    validation.valid &&
    validation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    ACTIVITY_WIRE_EVENT_TYPES.has(text(envelope?.payload?.eventType)),
  );
}

// Durability boundary of an activity. ACTIVITY_DELTA is a transport fragment: it feeds the
// live projection only. The standalone activity event carries the complete text and is the
// single durable fact of that activity, so only it may trigger persistence.
export function isDurableActivityMessageEvent(envelope = {}) {
  return (
    isCanonicalActivityMessageEvent(envelope) &&
    text(envelope?.payload?.eventType) !== MESSAGE_EVENT_TYPE.ACTIVITY_DELTA
  );
}

export function projectCanonicalActivityTimelineEvent(envelope = {}) {
  if (!isCanonicalActivityMessageEvent(envelope)) return null;
  const eventId = text(envelope?.identity?.eventId);
  const payloadEventType = text(envelope?.payload?.eventType);
  const isDelta = payloadEventType === MESSAGE_EVENT_TYPE.ACTIVITY_DELTA;
  const eventType = isDelta ? text(envelope?.payload?.activityEventType) : payloadEventType;
  const sequence = Number(envelope?.ordering?.sequence || 0);
  const sequenceScopeId = text(envelope?.ordering?.scopeId);
  const sequenceDomain = text(envelope?.ordering?.domain);
  const content = envelope?.payload?.text;
  if (
    !eventId ||
    !eventType ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    !sequenceScopeId ||
    !sequenceDomain ||
    typeof content !== "string"
  ) {
    return null;
  }
  const fact = {
    eventId,
    eventType,
    text: isDelta ? content : content.trim(),
    activityKind: text(envelope?.payload?.activityKind),
    purpose: text(envelope?.payload?.purpose),
    pluginFlow: text(envelope?.payload?.pluginFlow),
    chain: text(envelope?.payload?.chain),
    relayCorrelationId: text(envelope?.payload?.relayCorrelationId),
    sequence,
    sequenceScopeId,
    sequenceDomain,
    authority: "authoritative",
    timestamp: text(envelope?.occurredAt),
    sessionId: text(envelope?.identity?.sessionId),
    dialogProcessId: text(envelope?.payload?.dialogProcessId),
    turnScopeId: text(envelope?.identity?.turnScopeId),
    messageId: text(envelope?.identity?.messageId),
    presentationMessageId: text(envelope?.payload?.presentationMessageId),
  };
  const activityId = text(envelope?.payload?.activityId);
  if (activityId) fact.activityId = activityId;
  return Object.freeze(fact);
}

export function reduceCanonicalActivityTimeline(timeline = [], envelope = {}) {
  const fact = projectCanonicalActivityTimelineEvent(envelope);
  const next = Array.isArray(timeline) ? [...timeline] : [];
  if (!fact) return next;
  const index = next.findIndex((item) => text(item?.eventId) === fact.eventId);
  if (index >= 0) next[index] = fact;
  else {
    const activityId = text(fact.activityId);
    const activityIndex = activityId
      ? next.findIndex((item) => text(item?.activityId) === activityId)
      : -1;
    if (activityIndex >= 0) {
      // Deltas append to their activity; a standalone activity event is the activity's
      // complete text and replaces every fragment streamed before it.
      const isDelta = text(envelope?.payload?.eventType) === MESSAGE_EVENT_TYPE.ACTIVITY_DELTA;
      const previous = next[activityIndex];
      next[activityIndex] = Object.freeze({
        ...fact,
        text: isDelta ? `${String(previous?.text || "")}${fact.text}` : fact.text,
        activityId,
      });
    } else next.push(fact);
  }
  return next.sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0));
}

export function isCanonicalActivityTimelineFact(value = {}) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    text(value.eventId) &&
    ACTIVITY_EVENT_TYPES.has(text(value.eventType)) &&
    typeof value.text === "string" &&
    Number.isInteger(Number(value.sequence)) &&
    Number(value.sequence) > 0 &&
    text(value.sequenceScopeId) &&
    text(value.sequenceDomain) &&
    text(value.authority) === "authoritative" &&
    text(value.timestamp) &&
    text(value.sessionId) &&
    text(value.turnScopeId) &&
    text(value.messageId) &&
    text(value.presentationMessageId) &&
    Object.keys(value).every((field) => ACTIVITY_TIMELINE_FACT_FIELDS.has(field)),
  );
}

export function mergeCanonicalActivityTimelines(...timelines) {
  // One fact per activity: facts sharing an activityId are the same activity observed at
  // different points (mid-stream snapshot vs. completed); the higher sequence wins.
  const byIdentity = new Map();
  for (const fact of timelines.flat()) {
    if (!isCanonicalActivityTimelineFact(fact)) continue;
    const identity = text(fact.activityId)
      ? `activity:${text(fact.activityId)}`
      : `event:${text(fact.eventId)}`;
    const previous = byIdentity.get(identity);
    if (!previous || Number(fact.sequence) >= Number(previous.sequence)) {
      byIdentity.set(identity, fact);
    }
  }
  return [...byIdentity.values()].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  );
}

export function selectCanonicalActivityTimeline(message = {}) {
  return mergeCanonicalActivityTimelines(message?.activityTimeline || []);
}
