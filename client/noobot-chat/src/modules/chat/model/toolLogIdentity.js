/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function toolLogDetailKey(item = {}) {
  const toolCallId = text(item.toolCallId);
  const event = text(item.event).toLowerCase();
  if (!["tool_call", "tool_result"].includes(event)) return "";
  if (toolCallId) return `tool:${toolCallId}:${event === "tool_result" ? "result" : "call"}`;
  const eventId = text(item.eventId);
  return eventId ? `event:${eventId}` : "";
}
