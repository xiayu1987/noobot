/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect,
  isImageMime,
} from "../../../src/app/state/sessionMessageState.js";

describe("sessionMessageState", () => {
  it("formats message attachment and time helpers", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("text/plain")).toBe(false);
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatTime("2026-06-18T09:08:00.000Z")).toMatch(/\d{1,2}:\d{2}/);
  });

  it("allows reconnect only after a backend session identity exists", () => {
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: "" })).toBe(false);
    expect(
      hasActiveSessionForReconnect({
        activeSession: { sessionId: " backend " },
        activeSessionId: "",
      }),
    ).toBe(true);
    expect(
      hasActiveSessionForReconnect({
        activeSession: { id: " local ", isLocal: true },
        activeSessionId: "local",
      }),
    ).toBe(false);
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: " active " })).toBe(
      false,
    );
  });
});
