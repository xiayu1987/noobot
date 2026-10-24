/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createSerializedWindowIndex } from "@noobot/timeline-runtime";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export function createMessageEventState() {
  return {
    lastSequence: 0,
    finalContentSequence: 0,
    consumedEventIds: [],
    pendingEnvelopes: {},
  };
}

const CONSUMED_EVENT_LIMIT = QUANTITY_THRESHOLDS.client.consumedEventIdsLimit;
const consumedMessageEvents = createSerializedWindowIndex({
  field: "consumedEventIds",
  limit: CONSUMED_EVENT_LIMIT,
});

export function hasConsumedMessageEvent(state, eventId) {
  return consumedMessageEvents.has(state, eventId);
}

export function appendConsumedMessageEvent(state, eventId) {
  return consumedMessageEvents.append(state, eventId);
}
