/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  countCanonicalThinkingDetailEvents,
  countCanonicalToolTimelineEvents,
} from "@noobot/event-protocol/tool-timeline";

function protocolCount(messageItem = {}) {
  const count = Number(messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function selectThinkingDetailCount(messageItem = {}) {
  const explicitCount = protocolCount(messageItem);
  const timelineCount = countCanonicalThinkingDetailEvents({
    toolTimeline: messageItem?.toolTimeline,
    activityTimeline: messageItem?.activityTimeline,
  });
  const canonicalCount = Math.max(explicitCount, timelineCount);
  if (canonicalCount > 0) return canonicalCount;
  const toolCalls = Array.isArray(messageItem?.toolCalls)
    ? messageItem.toolCalls
    : Array.isArray(messageItem?.tool_calls)
      ? messageItem.tool_calls
      : [];
  return toolCalls.length;
}

export function selectExecutionRecordCount(messageItem = {}) {
  return countCanonicalToolTimelineEvents(messageItem?.toolTimeline);
}
