/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageEventSequenceIdentity } from "@noobot/shared/message-event-protocol";

/** Initialize event-consumer state without interpreting any event facts. */
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

/**
 * A rendered assistant turn is an aggregate projection. One model turn can
 * contain several persisted assistant messages (tool calls, then final text),
 * and each message owns a sequence that starts at 1. Keep those cursors in
 * separate lanes while projecting their facts into the same turn message.
 */
export function resolveMessageEventLaneState(message = {}, envelope = {}) {
  const root = initializeMessageEventState(message).messageEventState;
  const sequenceIdentity = resolveMessageEventSequenceIdentity(envelope);
  const eventMessageId = text(envelope?.messageId);
  const sequenceScopeId = text(sequenceIdentity.sequenceScopeId);
  const targetMessageId = text(message?.messageId || message?.id);
  const aggregateProjection = message?.turnPlaceholder === true ||
    !targetMessageId ||
    Boolean(eventMessageId && eventMessageId !== targetMessageId);
  if (!aggregateProjection || !sequenceScopeId) return root;
  if (!root.sequenceLanesByScopeId || typeof root.sequenceLanesByScopeId !== "object") {
    root.sequenceLanesByScopeId = root.lanesByMessageId && typeof root.lanesByMessageId === "object"
      ? root.lanesByMessageId
      : {};
  }
  if (!root.sequenceLanesByScopeId[sequenceScopeId]) {
    root.sequenceLanesByScopeId[sequenceScopeId] = createLaneState();
  }
  const lane = root.sequenceLanesByScopeId[sequenceScopeId];
  if (!Number.isFinite(Number(lane.lastSequence))) lane.lastSequence = 0;
  if (!Array.isArray(lane.consumedEventIds)) lane.consumedEventIds = [];
  return lane;
}

/** Keep legacy diagnostics readable without using the aggregate cursor for reduction. */
export function syncMessageEventAggregateState(message = {}) {
  const root = initializeMessageEventState(message).messageEventState;
  const lanes = Object.values(
    root.sequenceLanesByScopeId || root.lanesByMessageId || {},
  );
  if (!lanes.length) return root;
  root.lastSequence = lanes.reduce(
    (maximum, lane) => Math.max(maximum, Number(lane?.lastSequence || 0)),
    Number(root.lastSequence || 0),
  );
  root.consumedEventIds = [...new Set([
    ...root.consumedEventIds,
    ...lanes.flatMap(
      (lane) => Array.isArray(lane?.consumedEventIds) ? lane.consumedEventIds : [],
    ),
  ])].slice(-1000);
  return root;
}
