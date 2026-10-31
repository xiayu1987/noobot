/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  mergeCanonicalActivityTimelines,
  selectCanonicalActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";

export function mergeActivityTimelines(...timelines) {
  return mergeCanonicalActivityTimelines(...timelines);
}

export function selectActivityTimelineLogs(message = {}) {
  return selectCanonicalActivityTimeline(message);
}

export function selectLatestAnalysisActivities(message = {}) {
  const timeline = selectCanonicalActivityTimeline(message);
  const latestModelAnalysis =
    timeline.findLast((item) => item.eventType === MESSAGE_EVENT_TYPE.MODEL_ANALYSIS) || null;
  return {
    activityTimeline: timeline,
    activityTimelineCount: timeline.length,
    latestModelAnalysis,
  };
}
