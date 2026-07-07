import { describe, expect, it, vi } from "vitest";
import { formatDurationMs, resolveThinkingDurationMs } from "../../../../src/composables/infra/timeFields";

describe("timeFields thinking duration responsibilities", () => {
  it("formats milliseconds as mm:ss or hh:mm:ss", () => {
    expect(formatDurationMs(0)).toBe("00:00");
    expect(formatDurationMs(65000)).toBe("01:05");
    expect(formatDurationMs(3661000)).toBe("01:01:01");
  });

  it("uses message thinking timestamps before channel and local cache for completed duration", () => {
    const duration = resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:05.000Z",
      messageFinishedAt: "2026-06-22T10:00:12.000Z",
      channelStartedAt: "2026-06-22T10:00:03.000Z",
      channelFinishedAt: "2026-06-22T10:00:18.000Z",
      cachedStartedAt: "2026-06-22T10:00:00.000Z",
      cachedFinishedAt: "2026-06-22T10:00:20.000Z",
    });

    expect(duration).toBe(7000);
  });

  it("uses channel timing before local cache when message thinking fields are absent", () => {
    const duration = resolveThinkingDurationMs({
      channelStartedAt: "2026-06-22T10:00:08.000Z",
      channelFinishedAt: "2026-06-22T10:00:14.000Z",
      cachedStartedAt: "2026-06-22T10:00:00.000Z",
      cachedFinishedAt: "2026-06-22T10:00:20.000Z",
    });

    expect(duration).toBe(6000);
  });

  it("uses now minus resolved start while running and freezes on finish while completed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:30.000Z"));

    expect(resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:10.000Z",
      messageFinishedAt: "2026-06-22T10:00:15.000Z",
      now: "2026-06-22T10:00:30.000Z",
      pending: true,
    })).toBe(20000);

    expect(resolveThinkingDurationMs({
      messageStartedAt: "2026-06-22T10:00:10.000Z",
      messageFinishedAt: "2026-06-22T10:00:15.000Z",
      now: "2026-06-22T10:00:30.000Z",
      pending: false,
    })).toBe(5000);

    vi.useRealTimers();
  });

  it("falls back to local cache and then legacy log/message timestamps only when authoritative timing is missing", () => {
    expect(resolveThinkingDurationMs({
      cachedStartedAt: "2026-06-22T10:00:00.000Z",
      cachedFinishedAt: "2026-06-22T10:00:11.000Z",
      fallbackStartedAt: "2026-06-22T10:00:02.000Z",
      fallbackFinishedAt: "2026-06-22T10:00:09.000Z",
    })).toBe(11000);

    expect(resolveThinkingDurationMs({
      fallbackStartedAt: "2026-06-22T10:00:02.000Z",
      fallbackFinishedAt: "2026-06-22T10:00:09.000Z",
    })).toBe(7000);
  });
});
