/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  matchesMessageStatusRow,
  matchesThinkingPanel,
} from "../../../../../plugin/noobot-plugin-harness/frontend/index.js";

describe("harness message status renderer", () => {
  it("matches an authoritative child Execution display projection", () => {
    expect(matchesMessageStatusRow({
      role: "assistant",
      projectedStatusStepState: "completed",
    })).toBe(true);
  });

  it("matches a refreshed assistant message with only persisted status", () => {
    expect(matchesMessageStatusRow({
      role: "assistant",
      persistedStatusStepState: "completed",
    })).toBe(true);
  });

  it("matches a refreshed assistant message with projected status identity", () => {
    expect(matchesMessageStatusRow({
      role: "assistant",
      statusTurnScopeId: "client-turn:test",
    })).toBe(true);
  });

  it("does not match unrelated or user messages", () => {
    expect(matchesMessageStatusRow({ role: "assistant" })).toBe(false);
    expect(matchesMessageStatusRow({
      role: "user",
      persistedStatusStepState: "completed",
    })).toBe(false);
  });
});

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
