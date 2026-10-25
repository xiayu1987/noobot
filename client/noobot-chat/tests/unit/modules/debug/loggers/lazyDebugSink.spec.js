/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { buildSessionLogRecord } from "@noobot/runtime-events/session-log-protocol";
import {
  buildLazyDebugRecord,
  emitLazyDebug,
  scopeSessionLogRecord,
} from "../../../../../src/modules/debug/loggers/lazyDebugSink.js";

describe("lazyDebugSink", () => {
  it("scopes a hand-built record without an active session as a valid system record", () => {
    const record = scopeSessionLogRecord({
      category: "system",
      event: "reconnect.failed",
      sessionId: "",
      dialogProcessId: "",
      turnScopeId: "",
      data: { event: "reconnect.failed" },
    });
    expect(record.scope).toBe("system");
    expect(record).not.toHaveProperty("sessionId");
    expect(record).not.toHaveProperty("dialogProcessId");
    expect(() => buildSessionLogRecord({ ...record, source: "frontend" })).not.toThrow();
  });

  it("scopes a hand-built record with a session as a session record", () => {
    const record = scopeSessionLogRecord({
      category: "state",
      event: "conversation.state",
      sessionId: " s-1 ",
      turnScopeId: "t-1",
      data: {},
    });
    expect(record).toMatchObject({ scope: "session", sessionId: "s-1", turnScopeId: "t-1" });
    expect(buildSessionLogRecord({ ...record, source: "frontend" }).sessionId).toBe("s-1");
  });

  it("builds a session record from the payload's own session identity", () => {
    const record = buildLazyDebugRecord("stop", "stop.requested", {
      sessionId: " s-1 ",
      dialogProcessId: "dp-1",
      turnScopeId: "t-1",
      reason: "user",
    });
    expect(record).toEqual({
      scope: "session",
      category: "debug",
      level: "debug",
      debugType: "stop",
      event: "stop.requested",
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "t-1",
      data: {
        event: "stop.requested",
        sessionId: " s-1 ",
        dialogProcessId: "dp-1",
        turnScopeId: "t-1",
        reason: "user",
      },
    });
    expect(() => buildSessionLogRecord({ ...record, source: "frontend" })).not.toThrow();
  });

  it("declares a session-less diagnostic as a system record without identity", () => {
    const record = buildLazyDebugRecord("plugin-runtime-diagnostics", "plugin.loaded", {
      pluginId: "p-1",
      dialogProcessId: "dp-ignored",
    });
    expect(record.scope).toBe("system");
    expect(record).not.toHaveProperty("sessionId");
    expect(record).not.toHaveProperty("dialogProcessId");
    expect(record).not.toHaveProperty("turnScopeId");
    expect(buildSessionLogRecord({ ...record, source: "frontend" }).scope).toBe("system");
  });

  it("does not consult nested state for identity", () => {
    const record = buildLazyDebugRecord("stop-continue", "continue.selected", {
      runState: { sessionId: "s-nested", dialogProcessId: "dp-nested" },
    });
    expect(record.scope).toBe("system");
    expect(record).not.toHaveProperty("sessionId");
  });

  it("treats a non-string sessionId as absent", () => {
    expect(buildLazyDebugRecord("stop", "e", { sessionId: 42 }).scope).toBe("system");
  });

  it("forwards an explicit parentSessionId as the session record's parent declaration", () => {
    const record = buildLazyDebugRecord("turn-runtime-diagnostics", "e", {
      sessionId: "child-1",
      parentSessionId: " parent-1 ",
    });
    expect(record.scope).toBe("session");
    expect(record.sessionId).toBe("child-1");
    expect(record.parentSessionId).toBe("parent-1");
    expect(buildSessionLogRecord({ ...record, source: "frontend" }).parentSessionId).toBe(
      "parent-1",
    );
  });

  it("omits parentSessionId when the payload declares none or names no session", () => {
    expect(buildLazyDebugRecord("stop", "e", { sessionId: "s-1" })).not.toHaveProperty(
      "parentSessionId",
    );
    expect(
      buildLazyDebugRecord("stop", "e", { parentSessionId: "parent-only" }),
    ).not.toHaveProperty("parentSessionId");
  });

  it("resolves a lazy payload only when the debug type is enabled", () => {
    const payload = vi.fn(() => ({ sessionId: "s-1" }));
    const disabledSink = { isEnabled: () => false, debug: vi.fn() };
    expect(emitLazyDebug(disabledSink, "stop", "e", payload)).toBe(false);
    expect(payload).not.toHaveBeenCalled();

    const sink = { isEnabled: () => true, debug: vi.fn((_type, factory) => factory()) };
    const record = emitLazyDebug(sink, "stop", "e", payload);
    expect(payload).toHaveBeenCalledTimes(1);
    expect(record.sessionId).toBe("s-1");
  });
});
