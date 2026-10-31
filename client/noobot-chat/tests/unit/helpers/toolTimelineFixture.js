/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveCanonicalToolTimelineStatus } from "@noobot/event-protocol/tool-timeline";

export function completedToolTimelineItem({
  toolCallId,
  tool,
  args,
  result,
  success,
  call,
  resultEvent,
}) {
  const entry = {
    key: `call:${toolCallId}`,
    toolCallId,
    tool,
    args,
    ...(call === undefined ? {} : { call }),
    result,
    success,
    resultEvent,
    riskLevel: "",
  };
  return { ...entry, status: resolveCanonicalToolTimelineStatus(entry) };
}

export function toolResultText(value) {
  return JSON.stringify(value);
}
