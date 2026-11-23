/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";

export function selectThinkingDetailCount(messageItem = {}) {
  return countCanonicalThinkingDetailEvents({
    toolTimeline: messageItem?.toolTimeline,
    activityTimeline: messageItem?.activityTimeline,
  });
}

export function formatThinkingDetailLabel(translate, count) {
  return count > 0
    ? translate("message.thinkingDetailsCount", { count })
    : translate("message.thinkingDetails");
}
