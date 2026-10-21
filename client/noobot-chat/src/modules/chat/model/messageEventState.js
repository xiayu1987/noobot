/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createSerializedWindowIndex } from "@noobot/timeline-runtime";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { text, isObjectLike } from "@noobot/shared/value";

export function initializeMessageEventState(message = {}) {
  if (!Array.isArray(message.toolTimeline)) message.toolTimeline = [];
  if (!Array.isArray(message.activityTimeline)) message.activityTimeline = [];
  if (typeof message.content !== "string") message.content = String(message.content || "");
  if (!isObjectLike(message.messageEventState)) {
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
