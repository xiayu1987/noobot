/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createThinkingAnalysisProjection } from "../../../../../src/modules/chat/composables/thinkingPanelAnalysis.js";

function createProjection(messageItem) {
  return createThinkingAnalysisProjection({
    props: { messageItem },
    currentAnalysisProjection: ref({
      latestModelAnalysis: {
        eventId: "activity-1",
        text: "the streamed response",
      },
      latestGuidance: null,
      activityTimelineCount: 1,
    }),
    timelineMessage: (message) => message,
  });
}

describe("createThinkingAnalysisProjection", () => {
  it("keeps dedicated model analysis visible independently of final content", () => {
    const message = { messageEventState: { finalContentSequence: 0 } };
    expect(createProjection(message).getLatestModelAnalysisLog(message)).toMatchObject({
      eventId: "activity-1",
    });
  });
});
