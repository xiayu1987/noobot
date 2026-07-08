import { describe, expect, it, vi } from "vitest";
import { formatDurationMs, resolveThinkingDurationMs } from "../../../../src/composables/infra/timeFields";

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
    expect(resolveThinkingDurationMs({
      channelStartedAt: "2026-06-22T10:00:08.000Z",
      channelFinishedAt: "2026-06-22T10:00:14.000Z",
      cachedStartedAt: "2026-06-22T10:00:00.000Z",
      cachedFinishedAt: "2026-06-22T10:00:20.000Z",
      fallbackStartedAt: "2026-06-22T10:00:02.000Z",
      fallbackFinishedAt: "2026-06-22T10:00:09.000Z",
    })).toBe(0);
  });

  it("freezes on message finish even when pending is true", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:30.000Z"));

    expect(resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:10.000Z",
      messageFinishedAt: "2026-06-22T10:00:15.000Z",
      now: "2026-06-22T10:00:30.000Z",
      pending: true,
    })).toBe(5000);

    vi.useRealTimers();
  });

  it("uses now minus message start only while running without finish", () => {
    expect(resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:10.000Z",
      now: "2026-06-22T10:00:30.000Z",
      pending: true,
    })).toBe(20000);

    expect(resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:10.000Z",
      now: "2026-06-22T10:00:30.000Z",
      pending: false,
    })).toBe(0);
  });
});
