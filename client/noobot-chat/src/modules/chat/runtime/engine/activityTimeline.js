/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  mergeCanonicalActivityTimelines,
  reduceCanonicalActivityTimeline,
  selectCanonicalActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";

export function reduceActivityTimeline(timeline = [], envelope = {}) {
  return reduceCanonicalActivityTimeline(timeline, envelope);
}

export function mergeActivityTimelines(...timelines) {
  return mergeCanonicalActivityTimelines(...timelines);
}

export function selectActivityTimeline(message = {}) {
  return selectCanonicalActivityTimeline(message);
}

export function selectActivityTimelineLogs(message = {}) {
  return selectCanonicalActivityTimeline(message);
}

export function selectLatestAnalysisActivities(message = {}) {
  const timeline = selectCanonicalActivityTimeline(message);
  let latestGuidance = null;
  let latestModelAnalysis = null;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (
      !latestGuidance &&
      item.eventType === MESSAGE_EVENT_TYPE.THINKING &&
      item.activityKind === "guidance_analysis"
    ) {
      latestGuidance = item;
    }
    if (!latestModelAnalysis && item.eventType === MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT) {
      latestModelAnalysis = item;
    }
    if (latestGuidance && latestModelAnalysis) break;
  }
  return {
    activityTimelineCount: timeline.length,
    latestGuidance,
    latestModelAnalysis,
  };
}
