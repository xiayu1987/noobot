/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
*/

import { createSerializedWindowIndex } from "@noobot/timeline-runtime";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export function initializeMessageEventState(message = {}) {
  if (!Array.isArray(message.toolTimeline)) message.toolTimeline = [];
  if (!Array.isArray(message.activityTimeline)) message.activityTimeline = [];
  if (typeof message.content !== "string") message.content = String(message.content || "");
  if (!message.messageEventState || typeof message.messageEventState !== "object") {
    message.messageEventState = { lastSequence: 0, consumedEventIds: [] };
  }
  if (!Number.isFinite(Number(message.messageEventState.lastSequence))) {
    message.messageEventState.lastSequence = 0;
  }
  if (!Array.isArray(message.messageEventState.consumedEventIds)) {
    message.messageEventState.consumedEventIds = [];
  }
  return message;
}

const text = (value) => String(value || "").trim();
const CONSUMED_EVENT_LIMIT = QUANTITY_THRESHOLDS.client.consumedEventIdsLimit;
const consumedMessageEvents = createSerializedWindowIndex({
  field: "consumedEventIds",
  limit: CONSUMED_EVENT_LIMIT,
});

export function hasConsumedMessageEvent(state = {}, eventId = "") {
  const normalizedEventId = text(eventId);
  return Boolean(normalizedEventId && consumedMessageEvents.has(state, normalizedEventId));
}

export function appendConsumedMessageEvent(state = {}, eventId = "") {
  const normalizedEventId = text(eventId);
  if (!normalizedEventId) return false;
  return consumedMessageEvents.append(state, normalizedEventId);
}

function createLaneState() {
  return { lastSequence: 0, consumedEventIds: [] };
}

export function resolveMessageEventLaneState(message = {}, envelope = {}) {
  const root = initializeMessageEventState(message).messageEventState;
  const sequenceScopeId = text(envelope?.ordering?.scopeId);
  const sourceMessageId = text(envelope?.identity?.messageId);
  const presentationMessageId = text(envelope?.payload?.presentationMessageId);
  const aggregateProjection = Boolean(
    sequenceScopeId && sourceMessageId && presentationMessageId && sourceMessageId !== presentationMessageId,
  );
  if (!aggregateProjection) return root;
  if (!root.sequenceLanesByScopeId || typeof root.sequenceLanesByScopeId !== "object") {
    root.sequenceLanesByScopeId = {};
  }
  if (!root.sequenceLanesByScopeId[sequenceScopeId]) {
    root.sequenceLanesByScopeId[sequenceScopeId] = createLaneState();
  }
  const lane = root.sequenceLanesByScopeId[sequenceScopeId];
  if (!Number.isFinite(Number(lane.lastSequence))) lane.lastSequence = 0;
  if (!Array.isArray(lane.consumedEventIds)) lane.consumedEventIds = [];
  return lane;
}

export function syncMessageEventAggregateState(message = {}, eventId = "") {
  const root = initializeMessageEventState(message).messageEventState;
  const lanes = Object.values(root.sequenceLanesByScopeId || {});
  if (!lanes.length) return root;
  root.lastSequence = lanes.reduce(
    (maximum, lane) => Math.max(maximum, Number(lane?.lastSequence || 0)),
    0,
  );
  if (eventId) appendConsumedMessageEvent(root, eventId);
  else {
    root.consumedEventIds = [...new Set(lanes.flatMap(
      (lane) => Array.isArray(lane?.consumedEventIds) ? lane.consumedEventIds : [],
    ))].slice(-CONSUMED_EVENT_LIMIT);
  }
  return root;
}
