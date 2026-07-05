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

  it("does not write to the session log sink when resend debug is disabled", () => {
    const sink = { log: vi.fn() };
    setResendDebugLogSink(sink);

    expect(isResendDebugEnabled()).toBe(false);
    logResendDebug("resend.disabled", { sessionId: "s-1" });

    expect(sink.log).not.toHaveBeenCalled();
  });

  it("writes enabled resend debug events to the injected session log sink", () => {
    vi.stubEnv("VITE_NOOBOT_RESEND_DEBUG", "true");
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
