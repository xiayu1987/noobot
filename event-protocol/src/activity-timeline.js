/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import {
  ACTIVITY_EVENT_TYPES,
  MESSAGE_EVENT_TYPE,
  isTransientMessageEvent,
} from "./message-event.js";

const ACTIVITY_WIRE_EVENT_TYPES = Object.freeze(
  new Set([...ACTIVITY_EVENT_TYPES, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA]),
);

export const ACTIVITY_TIMELINE_FACT_FIELDS = Object.freeze(
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
    "presentationMessageId",
    "activityId",
  ]),
);

export function isCanonicalActivityMessageEvent(envelope) {
  return ACTIVITY_WIRE_EVENT_TYPES.has(envelope.payload.eventType);
}

export function isDurableActivityMessageEvent(envelope) {
  return isCanonicalActivityMessageEvent(envelope) && !isTransientMessageEvent(envelope);
}

export function projectCanonicalActivityTimelineEvent(envelope, { position = 1 } = {}) {
  if (!isCanonicalActivityMessageEvent(envelope)) return null;
  const { identity, ordering, payload } = envelope;
  const isDelta = isTransientMessageEvent(envelope);
  const fact = {
    eventId: text(identity.eventId),
    eventType: text(isDelta ? payload.activityEventType : payload.eventType),
    text: payload.text,
    activityKind: text(payload.activityKind),
    purpose: text(payload.purpose),
    pluginFlow: text(payload.pluginFlow),
    chain: text(payload.chain),
    relayCorrelationId: text(payload.relayCorrelationId),
    sequence: isDelta ? Math.max(1, position) : Number(ordering.sequence),
    sequenceScopeId: text(ordering.scopeId),
    sequenceDomain: text(ordering.domain),
    authority: "authoritative",
    timestamp: text(envelope.occurredAt),
    sessionId: text(identity.sessionId),
    dialogProcessId: text(payload.dialogProcessId),
    turnScopeId: text(identity.turnScopeId),
    presentationMessageId: text(payload.presentationMessageId),
  };
  const activityId = text(payload.activityId);
  if (activityId) fact.activityId = activityId;
  return Object.freeze(fact);
}

function insertBySequence(timeline, fact) {
  let index = timeline.length;
  while (index > 0 && timeline[index - 1].sequence > fact.sequence) {
    index -= 1;
  }
  timeline.splice(index, 0, fact);
  return timeline;
}

function replaceSameEventFact(next, sameEventIndex, envelope, isDelta) {
  if (isDelta) return next;
  next.splice(sameEventIndex, 1);
  return insertBySequence(next, projectCanonicalActivityTimelineEvent(envelope));
}

function mergeActivityFact(next, envelope, isDelta) {
  const activityId = text(envelope.payload.activityId);
  const activityIndex = activityId ? next.findIndex((item) => item.activityId === activityId) : -1;
  const previous = activityIndex >= 0 ? next[activityIndex] : null;
  const tail = next.length ? next[next.length - 1].sequence : 0;
  const fact = projectCanonicalActivityTimelineEvent(envelope, {
    position: previous ? previous.sequence : tail,
  });
  if (!previous) return insertBySequence(next, fact);

  next.splice(activityIndex, 1);
  return insertBySequence(
    next,
    isDelta ? Object.freeze({ ...fact, text: `${previous.text}${fact.text}` }) : fact,
  );
}

export function reduceCanonicalActivityTimeline(timeline, envelope) {
  const next = [...timeline];
  if (!isCanonicalActivityMessageEvent(envelope)) return next;
  const eventId = envelope.identity.eventId;
  const isDelta = isTransientMessageEvent(envelope);
  const sameEventIndex = next.findIndex((item) => item.eventId === eventId);
  if (sameEventIndex >= 0) return replaceSameEventFact(next, sameEventIndex, envelope, isDelta);
  return mergeActivityFact(next, envelope, isDelta);
}

export function isCanonicalActivityTimelineFact(value) {
  return Boolean(
    isPlainObject(value) &&
    text(value.eventId) &&
    ACTIVITY_EVENT_TYPES.has(text(value.eventType)) &&
    typeof value.text === "string" &&
    Number.isInteger(value.sequence) &&
    value.sequence > 0 &&
    text(value.sequenceScopeId) &&
    text(value.sequenceDomain) &&
    text(value.authority) === "authoritative" &&
    text(value.timestamp) &&
    text(value.sessionId) &&
    text(value.turnScopeId) &&
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
    if (!previous || fact.sequence >= previous.sequence) {
      byIdentity.set(identity, fact);
    }
  }
  return [...byIdentity.values()].sort((left, right) => left.sequence - right.sequence);
}

export function selectMessageActivityTimeline(message) {
  return message.activityTimeline ?? [];
}

export function selectCanonicalActivityTimeline(message) {
  return mergeCanonicalActivityTimelines(selectMessageActivityTimeline(message));
}
