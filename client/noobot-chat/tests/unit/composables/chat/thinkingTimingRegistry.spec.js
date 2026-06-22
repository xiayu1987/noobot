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

  it("persists a thinking start time and resolves it by clientTurnId after refresh", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    const rawAfterRefresh = globalThis.localStorage.getItem(THINKING_TIMING_STORAGE_KEY);
    expect(rawAfterRefresh).toContain("client-1");

    expect(
      resolveThinkingTiming({ sessionId: "session-1", clientTurnId: "client-1" }),
    ).toMatchObject({
      sessionId: "session-1",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("resolves by clientTurnId when the session id changes after backend promotion", () => {
    rememberThinkingStarted({
      sessionId: "local-session-before-promotion",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    expect(
      resolveThinkingTiming({ sessionId: "backend-session-after-refresh", clientTurnId: "client-1" }),
    ).toMatchObject({
      sessionId: "local-session-before-promotion",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("does not reset an existing start time when the same running state is replayed later", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
    rememberThinkingStarted({
      sessionId: "session-1",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:12.000Z"),
    });

    expect(resolveThinkingTiming({ sessionId: "session-1", clientTurnId: "client-1" })).toMatchObject({
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("binds a backend dialogProcessId to the existing client turn timing", () => {
    rememberThinkingStarted({
      sessionId: "session-1",
      clientTurnId: "client-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });

    bindThinkingDialogProcess({
      sessionId: "session-1",
      clientTurnId: "client-1",
      dialogProcessId: "dialog-1",
    });

    expect(resolveThinkingTiming({ sessionId: "session-1", dialogProcessId: "dialog-1" })).toMatchObject({
      clientTurnId: "client-1",
      dialogProcessId: "dialog-1",
      startedAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
    });
  });

  it("keeps finished timing available for completed render instead of clearing immediately", () => {
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
