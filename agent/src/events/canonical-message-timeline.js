/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import {
  isCanonicalToolMessageEvent,
  reduceCanonicalToolTimeline,
} from "@noobot/event-protocol/tool-timeline";

export { reduceCanonicalToolTimeline };

export function isToolMessageEvent(envelope = {}) {
  return isCanonicalToolMessageEvent(envelope);
}

export function isActivityMessageEvent(envelope = {}) {
  return [MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT].includes(
    envelope?.payload?.eventType,
  );
}
