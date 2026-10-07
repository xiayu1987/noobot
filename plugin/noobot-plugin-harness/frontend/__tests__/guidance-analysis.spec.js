/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  GUIDANCE_ANALYSIS_ACTIVITY_KIND,
  selectGuidanceAnalyses,
  selectVisibleGuidanceAnalyses,
} from "../guidance-analysis.js";

const guidance = (eventId, text) => ({
  eventId,
  activityKind: GUIDANCE_ANALYSIS_ACTIVITY_KIND,
  text,
});

describe("harness guidance analysis selection", () => {
  const activityTimeline = [
    guidance("g-1", "first"),
    { eventId: "host-1", activityKind: "main_model_analysis", text: "host" },
    guidance("g-empty", "   "),
    guidance("g-2", "second"),
  ];

  it("selects only non-empty guidance analysis activities", () => {
    expect(selectGuidanceAnalyses(activityTimeline).map((item) => item.eventId)).toEqual([
      "g-1",
      "g-2",
    ]);
    expect(selectGuidanceAnalyses(null)).toEqual([]);
  });

  it("shows the latest analysis in the panel and all analyses in details", () => {
    expect(
      selectVisibleGuidanceAnalyses({ activityTimeline, variant: "panel" }).map(
        (item) => item.eventId,
      ),
    ).toEqual(["g-2"]);
    expect(
      selectVisibleGuidanceAnalyses({ activityTimeline, variant: "details" }).map(
        (item) => item.eventId,
      ),
    ).toEqual(["g-1", "g-2"]);
  });
});
