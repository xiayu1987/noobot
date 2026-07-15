// Tests split by responsibility from ThinkingPanel.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

describe("ThinkingPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps pending elapsed time from message thinking start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      sessionId: "backend-session-after-refresh",
      turnScopeId: "client-turn-orphan-resend",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      ts: "2026-06-22T10:00:12.000Z",
      channelState: { state: "sending" },
    });

    expect(wrapper.text()).toContain("00:12");
  });

  

  it("uses message finish minus start for completed elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:16.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      sessionId: "session-finished",
      turnScopeId: "client-turn-finished",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:15.000Z",
      ts: "2026-06-22T10:05:00.000Z",
      completedToolLogs: [{ type: "tool_result", text: "done", ts: "2026-06-22T10:05:00.000Z" }],
    });

    expect(wrapper.text()).toContain("00:15");
    expect(wrapper.text()).not.toContain("05:00");
  });

  it("prefers refreshed message thinking timestamps over stale local timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:30.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      sessionId: "session-refreshed-server-time",
      turnScopeId: "client-turn-refreshed-server-time",
      thinkingStartedAt: "2026-06-22T10:00:05.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:12.000Z",
      completedToolLogs: [{ type: "tool_result", text: "done", ts: "2026-06-22T10:00:12.000Z" }],
    });

    expect(wrapper.text()).toContain("00:07");
    expect(wrapper.text()).not.toContain("00:20");
  });

  it("uses message thinking start instead of stale local or channel timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:20.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      sessionId: "session-running-channel-time",
      turnScopeId: "client-turn-running-channel-time",
      thinkingStartedAt: "2026-06-22T10:00:05.000Z",
      channelState: {
        state: "sending",
        createdAt: "2026-06-22T10:00:08.000Z",
      },
    });

    expect(wrapper.text()).toContain("00:15");
    expect(wrapper.text()).not.toContain("00:12");
    expect(wrapper.text()).not.toContain("00:20");
  });

  it("does not use channel state createdAt as thinking elapsed source", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      turnScopeId: "client-turn:refresh-created-at",
      channelState: {
        state: "sending",
        createdAt: "2026-06-22T10:00:00.000Z",
        createdAtMs: Date.parse("2026-06-22T10:00:00.000Z"),
      },
    });

    expect(wrapper.text()).toContain("00:00");
    expect(wrapper.text()).not.toContain("00:12");
  });

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  it("does not use channel turnScopeId timing before assistant turnScopeId is persisted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      sessionId: "session-current",
      ts: "2026-06-22T10:00:12.000Z",
      channelState: {
        state: "sending",
        turnScopeId: "client-turn:previous",
        createdAt: "2026-06-22T10:00:00.000Z",
      },
    });

    expect(wrapper.text()).toContain("00:00");
    expect(wrapper.text()).not.toContain("00:12");
  });

  

  

  

  

  

  
});
