import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THINKING_TIMING_STORAGE_KEY,
  bindThinkingDialogProcess,
  clearThinkingTiming,
  rememberThinkingFinished,
  rememberThinkingStarted,
  resolveThinkingTiming,
} from "../../../../src/composables/chat/thinkingTimingRegistry";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    },
  });
}

describe("thinkingTimingRegistry", () => {
  beforeEach(() => {
    installStorage();
    vi.useRealTimers();
  });

  it("persists a thinking start time and resolves it by turnScopeId after refresh", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    const rawAfterRefresh = globalThis.localStorage.getItem(THINKING_TIMING_STORAGE_KEY);
    expect(rawAfterRefresh).toContain("client-1");

    expect(
      resolveThinkingTiming({ sessionId: "session-1", turnScopeId: "client-1" }),
    ).toMatchObject({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("keeps turn timing scoped by sessionId and turnScopeId", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    expect(resolveThinkingTiming({ sessionId: "session-2", turnScopeId: "client-1" })).toBe(null);
    expect(
      resolveThinkingTiming({ sessionId: "session-1", turnScopeId: "client-1" }),
    ).toMatchObject({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("updates the session side of a turn timing when backend promotion replays the same turn", () => {
    rememberThinkingStarted({
      sessionId: "local-session-before-promotion",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
    rememberThinkingStarted({
      sessionId: "backend-session-after-refresh",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:03.000Z"),
    });

    expect(resolveThinkingTiming({
      sessionId: "backend-session-after-refresh",
      turnScopeId: "client-1",
    })).toMatchObject({
      sessionId: "backend-session-after-refresh",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
    expect(resolveThinkingTiming({
      sessionId: "local-session-before-promotion",
      turnScopeId: "client-1",
    })).toBe(null);
  });

  it("does not reset an existing start time when the same running state is replayed later", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
    rememberThinkingStarted({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:12.000Z"),
    });

    expect(resolveThinkingTiming({ sessionId: "session-1", turnScopeId: "client-1" })).toMatchObject({
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("binds a backend dialogProcessId to the existing turn scope timing", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    bindThinkingDialogProcess({
      sessionId: "session-1",
      turnScopeId: "client-1",
      dialogProcessId: "dialog-1",
    });

    expect(resolveThinkingTiming({ sessionId: "session-1", dialogProcessId: "dialog-1" })).toMatchObject({
      turnScopeId: "client-1",
      dialogProcessId: "dialog-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("does not resolve by dialogProcessId when the turn identity conflicts", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    expect(
      resolveThinkingTiming({
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-2",
      }),
    ).toBe(null);

    expect(
      resolveThinkingTiming({
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-2",
      }),
    ).toBe(null);
  });

  it("keeps finished timing available for completed render instead of clearing immediately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:16.000Z"));

    rememberThinkingStarted({
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
    rememberThinkingFinished({
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      finishedAtMs: Date.parse("2026-06-22T10:00:15.000Z"),
    });

    expect(resolveThinkingTiming({ sessionId: "session-1", dialogProcessId: "dialog-1" })).toMatchObject({
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
      finishedAtMs: Date.parse("2026-06-22T10:00:15.000Z"),
    });

    clearThinkingTiming({ sessionId: "session-1", dialogProcessId: "dialog-1" });
    expect(resolveThinkingTiming({ sessionId: "session-1", dialogProcessId: "dialog-1" })).toBe(null);
  });
});
