/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isResendDebugEnabled,
  logResendDebug,
  setResendDebugLogSink,
} from "../../../../../src/modules/debug/loggers/resendDebugLogger.js";

describe("resendDebugLogger", () => {
  beforeEach(() => {
    setResendDebugLogSink(null);
    vi.unstubAllEnvs();
  });

  it("writes resend debug events to the session log sink for runtime-events filtering", () => {
    const sink = { debug: vi.fn((debugType, factory) => factory()), isEnabled: () => true };
    setResendDebugLogSink(sink);

    expect(isResendDebugEnabled()).toBe(true);
    logResendDebug("resend.disabled", { sessionId: "s-1" });

    expect(sink.debug).toHaveBeenCalledWith("resend", expect.any(Function));
    expect(sink.debug.mock.results[0].value).toEqual(expect.objectContaining({
      category: "debug",
      debugType: "resend",
      event: "resend.disabled",
      sessionId: "s-1",
    }));
  });

  it("constructs lazy resend details only when the authoritative policy enables them", () => {
    const sink = { debug: vi.fn((debugType, factory) => factory()), isEnabled: () => true };
    setResendDebugLogSink(sink);

    logResendDebug("resend.trace", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "ts-1",
      detail: "payload",
    });

    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.debug.mock.results[0].value).toEqual(expect.objectContaining({
      category: "debug",
      event: "resend.trace",
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "ts-1",
      data: expect.objectContaining({
        event: "resend.trace",
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        turnScopeId: "ts-1",
        detail: "payload",
        at: expect.any(String),
      }),
    }));
  });

  it("does not construct a lazy payload when resend diagnostics are disabled", () => {
    const payload = vi.fn(() => ({ sessionId: "s-1" }));
    const sink = { debug: vi.fn(), isEnabled: () => false };
    setResendDebugLogSink(sink);

    expect(isResendDebugEnabled()).toBe(false);
    expect(logResendDebug("resend.disabled", payload)).toBe(false);
    expect(payload).not.toHaveBeenCalled();
    expect(sink.debug).not.toHaveBeenCalled();
  });
});
