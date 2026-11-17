/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  mergeCanonicalActivityTimelines,
  selectMessageActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  requireCanonicalToolTimelineIdentity,
  selectMessageToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import { projectThinkingDetailContentTimeline } from "@noobot/event-protocol/thinking-detail-content";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";

function mergeToolTimelineItems(items, timeline, indexByKey) {
  for (const item of items) {
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

function mergeToolTimeline(messages, selectToolTimeline) {
  const timeline = [];
  const indexByKey = new Map();
  for (const message of messages) {
    mergeToolTimelineItems(selectToolTimeline(message), timeline, indexByKey);
  }
  return timeline;
}

export function projectThinkingEventTimeline(
  roundMessages,
  selectToolTimeline = selectMessageToolTimeline,
) {
  const toolTimeline = mergeToolTimeline(roundMessages, selectToolTimeline);
  const activityTimeline = mergeCanonicalActivityTimelines(
    ...roundMessages.map(selectMessageActivityTimeline),
  );
  return { toolTimeline, activityTimeline };
}

export function projectThinkingTimeline(messages, { turnScopeId }) {
  const scope = requireCanonicalTurnScopeId(turnScopeId);
  const roundMessages = messages.filter((message) => message.turnScopeId === scope);
  const { toolTimeline, activityTimeline } = projectThinkingEventTimeline(roundMessages);
  const thinkingContentTimeline = projectThinkingDetailContentTimeline(
    roundMessages,
    activityTimeline,
  );
  return { roundMessages, toolTimeline, activityTimeline, thinkingContentTimeline };
}
