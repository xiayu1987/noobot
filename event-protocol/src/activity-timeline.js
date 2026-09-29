/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { EVENT_FAMILY, validateProtocolEvent } from "./event-registry.js";
import {
  ACTIVITY_EVENT_TYPES,
  MESSAGE_EVENT_TYPE,
  isTransientMessageEvent,
} from "./message-event.js";
import { text } from "./normalize.js";

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

export function isDurableActivityMessageEvent(envelope = {}) {
  return isCanonicalActivityMessageEvent(envelope) && !isTransientMessageEvent(envelope);
}

export function projectCanonicalActivityTimelineEvent(envelope = {}, { position = 1 } = {}) {
  if (!isCanonicalActivityMessageEvent(envelope)) return null;
  const eventId = text(envelope?.identity?.eventId);
  const isDelta = isTransientMessageEvent(envelope);
  const eventType = text(
    isDelta ? envelope?.payload?.activityEventType : envelope?.payload?.eventType,
  );
  const sequence = isDelta
    ? Math.max(1, Number(position) || 1)
    : Number(envelope?.ordering?.sequence || 0);
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
    text: content,
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

function insertBySequence(timeline, fact) {
  let index = timeline.length;
  while (index > 0 && Number(timeline[index - 1]?.sequence || 0) > Number(fact.sequence)) {
    index -= 1;
  }
  timeline.splice(index, 0, fact);
  return timeline;
}

function replaceSameEventFact(next, sameEventIndex, envelope, isDelta) {
  if (isDelta) return next;
  const replacement = projectCanonicalActivityTimelineEvent(envelope);
  if (!replacement) return next;
  next.splice(sameEventIndex, 1);
  return insertBySequence(next, replacement);
}

function mergeActivityFact(next, envelope, isDelta) {
  const activityId = text(envelope?.payload?.activityId);
  const activityIndex = activityId
    ? next.findIndex((item) => text(item?.activityId) === activityId)
    : -1;
  const previous = activityIndex >= 0 ? next[activityIndex] : null;
  const tail = Number(next[next.length - 1]?.sequence || 0);
  const fact = projectCanonicalActivityTimelineEvent(envelope, {
    position: previous ? Number(previous.sequence) : tail,
  });
  if (!fact) return next;
  if (!previous) return insertBySequence(next, fact);

  next.splice(activityIndex, 1);
  return insertBySequence(
    next,
    isDelta ? Object.freeze({ ...fact, text: `${String(previous.text || "")}${fact.text}` }) : fact,
  );
}

export function reduceCanonicalActivityTimeline(timeline = [], envelope = {}) {
  const next = Array.isArray(timeline) ? [...timeline] : [];
  if (!isCanonicalActivityMessageEvent(envelope)) return next;
  const eventId = text(envelope?.identity?.eventId);
  const isDelta = isTransientMessageEvent(envelope);
  const sameEventIndex = next.findIndex((item) => text(item?.eventId) === eventId);
  if (sameEventIndex >= 0) return replaceSameEventFact(next, sameEventIndex, envelope, isDelta);
  return mergeActivityFact(next, envelope, isDelta);
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
