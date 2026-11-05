/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  formatDurationMs,
  resolveThinkingDurationMs,
} from "../../../../../src/modules/chat/model/timeFields.js";

describe("timeFields thinking duration responsibilities", () => {
  it("formats milliseconds as mm:ss or hh:mm:ss", () => {
    expect(formatDurationMs(0)).toBe("00:00");
    expect(formatDurationMs(65000)).toBe("01:05");
    expect(formatDurationMs(3661000)).toBe("01:01:01");
  });

  it("uses only message thinking timestamps for completed duration", () => {
    const duration = resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:05.000Z",
      messageFinishedAt: "2026-06-22T10:00:12.000Z",
    });

    expect(duration).toBe(7000);
  });

  it("does not use channel, cache, or fallback timing as duration sources", () => {
    expect(
      resolveThinkingDurationMs({
        channelStartedAt: "2026-06-22T10:00:08.000Z",
        channelFinishedAt: "2026-06-22T10:00:14.000Z",
        cachedStartedAt: "2026-06-22T10:00:00.000Z",
        cachedFinishedAt: "2026-06-22T10:00:20.000Z",
        fallbackStartedAt: "2026-06-22T10:00:02.000Z",
        fallbackFinishedAt: "2026-06-22T10:00:09.000Z",
      }),
    ).toBeNull();
  });

  it("freezes on message finish even when pending is true", () => {
    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-06-22T10:00:10.000Z",
        messageFinishedAt: "2026-06-22T10:00:15.000Z",
        now: "2026-06-22T10:00:30.000Z",
        running: true,
      }),
    ).toBe(5000);
  });

  it("returns unknown while running before the server clock is observed", () => {
    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-06-22T10:00:10.000Z",
        now: null,
        running: true,
      }),
    ).toBeNull();
  });

  it("rejects negative or non-finite durations instead of formatting 00:00", () => {
    expect(() => formatDurationMs(-1)).toThrow(RangeError);
    expect(() => formatDurationMs(Number.NaN)).toThrow(RangeError);
  });

  it("uses now minus message start only while running without finish", () => {
    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-06-22T10:00:10.000Z",
        now: "2026-06-22T10:00:30.000Z",
        running: true,
      }),
    ).toBe(20000);

    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-06-22T10:00:10.000Z",
        now: "2026-06-22T10:00:30.000Z",
        running: false,
      }),
    ).toBeNull();
  });

  it("does not clamp a start later than now to zero (client clock skew)", () => {
    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-11-04T15:47:16.696Z",
        now: "2026-11-04T15:45:23.972Z",
        running: true,
      }),
    ).toBeNull();
  });

  it("returns unknown for missing or invalid persisted timing", () => {
    expect(resolveThinkingDurationMs()).toBeNull();
    expect(
      resolveThinkingDurationMs({
        messageStartedAt: "2026-06-22T10:00:20.000Z",
        messageFinishedAt: "2026-06-22T10:00:10.000Z",
      }),
    ).toBeNull();
  });
});
