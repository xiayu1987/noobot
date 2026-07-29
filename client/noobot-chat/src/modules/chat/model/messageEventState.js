/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
*/

import { resolveMessageEventSequenceIdentity } from "@noobot/shared/message-event-protocol";

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

function createLaneState() {
  return { lastSequence: 0, consumedEventIds: [] };
}

export function resolveMessageEventLaneState(message = {}, envelope = {}) {
  const root = initializeMessageEventState(message).messageEventState;
  const sequenceScopeId = text(resolveMessageEventSequenceIdentity(envelope).sequenceScopeId);
  const sourceMessageId = text(envelope?.messageId);
  const presentationMessageId = text(envelope?.presentationMessageId || envelope?.messageId);
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

export function syncMessageEventAggregateState(message = {}) {
  const root = initializeMessageEventState(message).messageEventState;
  const lanes = Object.values(root.sequenceLanesByScopeId || {});
  if (!lanes.length) return root;
  root.lastSequence = lanes.reduce(
    (maximum, lane) => Math.max(maximum, Number(lane?.lastSequence || 0)),
    0,
  );
  root.consumedEventIds = [...new Set(lanes.flatMap(
    (lane) => Array.isArray(lane?.consumedEventIds) ? lane.consumedEventIds : [],
  ))].slice(-1000);
  return root;
}
