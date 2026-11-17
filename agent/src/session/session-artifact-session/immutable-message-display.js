/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compactThinkingTimeline } from "@noobot/event-protocol/tool-timeline";
import { IMMUTABLE_MESSAGE_DISPLAY_VERSION } from "@noobot/session-protocol/immutable-storage-graph";

export async function indexImmutableMessageDisplay(objects, record, parts) {
  const part = parts.find(({ path }) => path[1] === "toolTimeline");
  const timeline = part ? await objects.readValue(part.reference) : record.message.toolTimeline;
  return {
    ...record,
    display: {
      version: IMMUTABLE_MESSAGE_DISPLAY_VERSION,
      toolTimeline: compactThinkingTimeline(timeline ?? []),
    },
  };
}
