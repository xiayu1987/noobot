/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeServerClock,
  readServerNowMs,
  resetServerClock,
} from "../../../../../src/modules/chat/model/serverClock.js";

describe("serverClock", () => {
  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
  });

  it("is unknown before the first server observation", () => {
    expect(readServerNowMs()).toBeNull();
  });

  it("strips serverNow and tracks server time by the observed offset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T15:45:23.972Z"));
    const document = observeServerClock({
      ok: true,
      sessionId: "s1",
      serverNow: "2026-11-04T15:47:16.696Z",
    });
    expect(document).toEqual({ ok: true, sessionId: "s1" });
    expect(readServerNowMs()).toBe(Date.parse("2026-11-04T15:47:16.696Z"));

    vi.advanceTimersByTime(5000);
    expect(readServerNowMs()).toBe(Date.parse("2026-11-04T15:47:21.696Z"));
  });

  it("rejects a missing or non-canonical serverNow without changing the offset", () => {
    expect(() => observeServerClock({ ok: true })).toThrow(
      expect.objectContaining({ code: "SERVER_CLOCK_INVALID" }),
    );
    expect(() => observeServerClock({ ok: true, serverNow: "2026-11-04 15:47" })).toThrow(
      expect.objectContaining({ code: "SERVER_CLOCK_INVALID" }),
    );
    expect(readServerNowMs()).toBeNull();
  });
});
