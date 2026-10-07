/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const GUIDANCE_ANALYSIS_ACTIVITY_KIND = "guidance_analysis";

function activityText(activity = {}) {
  return String(activity?.text || "").trim();
}

export function selectGuidanceAnalyses(activityTimeline = []) {
  return (Array.isArray(activityTimeline) ? activityTimeline : []).filter(
    (activity = {}) =>
      String(activity?.activityKind || "").trim() === GUIDANCE_ANALYSIS_ACTIVITY_KIND &&
      activityText(activity),
  );
}

export function selectVisibleGuidanceAnalyses({ activityTimeline = [], variant = "panel" } = {}) {
  const analyses = selectGuidanceAnalyses(activityTimeline);
  return variant === "details" ? analyses : analyses.slice(-1);
}
