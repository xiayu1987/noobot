/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mergeCanonicalActivityTimelines } from "@noobot/event-protocol/activity-timeline";
import { requireCanonicalToolTimelineIdentity } from "@noobot/event-protocol/tool-timeline";
import { projectThinkingDetailContentTimeline } from "@noobot/event-protocol/thinking-detail-content";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";

function mergeToolTimeline(messages) {
  const timeline = [];
  const indexByKey = new Map();
  for (const message of messages) {
    if (!Object.hasOwn(message, "toolTimeline")) continue;
    for (const item of message.toolTimeline) {
      const { key } = requireCanonicalToolTimelineIdentity(item);
      if (!indexByKey.has(key)) {
        indexByKey.set(key, timeline.length);
        timeline.push(item);
        continue;
      }
      const index = indexByKey.get(key);
      timeline[index] = { ...timeline[index], ...item };
    }
  }
  return timeline;
}

export function projectThinkingTimeline(messages, { turnScopeId }) {
  const scope = requireCanonicalTurnScopeId(turnScopeId);
  const roundMessages = messages.filter((message) => message.turnScopeId === scope);
  const toolTimeline = mergeToolTimeline(roundMessages);
  const activityTimeline = mergeCanonicalActivityTimelines(
    ...roundMessages.map((message) => message.activityTimeline ?? []),
  );
  const thinkingContentTimeline = projectThinkingDetailContentTimeline(
    roundMessages,
    activityTimeline,
  );
  return { roundMessages, toolTimeline, activityTimeline, thinkingContentTimeline };
}
