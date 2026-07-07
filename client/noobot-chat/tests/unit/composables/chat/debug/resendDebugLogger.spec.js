import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isResendDebugEnabled,
  logResendDebug,
  setResendDebugLogSink,
} from "../../../../../src/composables/chat/debug/resendDebugLogger";

describe("resendDebugLogger", () => {
  beforeEach(() => {
    setResendDebugLogSink(null);
    vi.unstubAllEnvs();
  });

  it("writes resend debug events to the session log sink for runtime-events filtering", () => {
    const sink = { log: vi.fn() };
    setResendDebugLogSink(sink);

    expect(isResendDebugEnabled()).toBe(true);
    logResendDebug("resend.disabled", { sessionId: "s-1" });

    expect(sink.log).toHaveBeenCalledWith(expect.objectContaining({
      category: "debug",
      debugType: "resend",
      event: "resend.disabled",
      sessionId: "s-1",
    }));
  });

  it("does not require a frontend resend debug switch to write to the injected session log sink", () => {
    const sink = { log: vi.fn() };
    setResendDebugLogSink(sink);

    logResendDebug("resend.trace", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "ts-1",
      detail: "payload",
    });

    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(sink.log).toHaveBeenCalledWith(expect.objectContaining({
      category: "debug",
      event: "resend.trace",
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "ts-1",
      data: expect.objectContaining({
        phase: "resend.trace",
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        turnScopeId: "ts-1",
        detail: "payload",
        at: expect.any(String),
      }),
    }));
  });
});
