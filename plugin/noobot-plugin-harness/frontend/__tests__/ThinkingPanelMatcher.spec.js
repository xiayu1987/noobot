/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { matchesThinkingPanel } from "../index.js";

describe("harness thinking panel renderer", () => {
  it("does not attach to user messages", () => {
    expect(matchesThinkingPanel({ role: "user" })).toBe(false);
    expect(matchesThinkingPanel({
      role: "user",
      activityTimeline: [{ text: "model reasoning" }],
    })).toBe(false);
  });

  it("attaches to a live workflow on the same assistant Turn shell", () => {
    expect(matchesThinkingPanel({
      role: "assistant",
      type: "workflow",
      __workflowLiveProjection: true,
    })).toBe(true);
  });

  it("continues matching normal and persisted workflow messages", () => {
    expect(matchesThinkingPanel({ role: "assistant" })).toBe(true);
    expect(matchesThinkingPanel({ role: "assistant", type: "workflow" })).toBe(true);
  });
});
