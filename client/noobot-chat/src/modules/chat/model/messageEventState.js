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

let consumedMessageEvents = null;

function consumedMessageEventIndex() {
  consumedMessageEvents ??= createSerializedWindowIndex({
    field: "consumedEventIds",
    limit: QUANTITY_THRESHOLDS.client.consumedEventIdsLimit,
  });
  return consumedMessageEvents;
}

export function hasConsumedMessageEvent(state, eventId) {
  return consumedMessageEventIndex().has(state, eventId);
}

export function appendConsumedMessageEvent(state, eventId) {
  return consumedMessageEventIndex().append(state, eventId);
}
