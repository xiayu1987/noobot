/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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
