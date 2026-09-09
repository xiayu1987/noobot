/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { EVENT_FAMILY, validateProtocolEvent } from "./event-registry.js";
import { MESSAGE_EVENT_TYPE } from "./message-event.js";
import { text } from "./normalize.js";

const ACTIVITY_EVENT_TYPES = Object.freeze(
  new Set([MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT]),
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
  ]),
);

export function isCanonicalActivityMessageEvent(envelope = {}) {
  const validation = validateProtocolEvent(envelope);
  return Boolean(
    validation.valid &&
    validation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    ACTIVITY_EVENT_TYPES.has(text(envelope?.payload?.eventType)),
  );
}

export function projectCanonicalActivityTimelineEvent(envelope = {}) {
  if (!isCanonicalActivityMessageEvent(envelope)) return null;
  const eventId = text(envelope?.identity?.eventId);
  const eventType = text(envelope?.payload?.eventType);
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
  return Object.freeze({
    eventId,
    eventType,
    text: content.trim(),
    activityKind: text(envelope?.payload?.activityKind),
    purpose: text(envelope?.payload?.purpose),
    pluginFlow: text(envelope?.payload?.pluginFlow),
    chain: text(envelope?.payload?.chain),
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
  });
}

export function reduceCanonicalActivityTimeline(timeline = [], envelope = {}) {
  const fact = projectCanonicalActivityTimelineEvent(envelope);
  const next = Array.isArray(timeline) ? [...timeline] : [];
  if (!fact) return next;
  const index = next.findIndex((item) => text(item?.eventId) === fact.eventId);
  if (index >= 0) next[index] = fact;
  else next.push(fact);
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
  const byEventId = new Map();
  for (const fact of timelines.flat()) {
    if (!isCanonicalActivityTimelineFact(fact)) continue;
    byEventId.set(text(fact.eventId), fact);
  }
  return [...byEventId.values()].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  );
}

export function selectCanonicalActivityTimeline(message = {}) {
  return mergeCanonicalActivityTimelines(message?.activityTimeline || []);
}
