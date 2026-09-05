/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isCanonicalActivityMessageEvent,
  reduceCanonicalActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  isCanonicalToolMessageEvent,
  reduceCanonicalToolTimeline,
} from "@noobot/event-protocol/tool-timeline";

export { reduceCanonicalActivityTimeline, reduceCanonicalToolTimeline };

export function isToolMessageEvent(envelope = {}) {
  return isCanonicalToolMessageEvent(envelope);
}

export function isActivityMessageEvent(envelope = {}) {
  return isCanonicalActivityMessageEvent(envelope);
}
