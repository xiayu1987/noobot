// Tests split by responsibility from ThinkingPanel.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
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
    const messageItem = {
      role: "assistant",
      pending: true,
      sessionId: "backend-session-after-refresh",
      turnScopeId: "client-turn-orphan-resend",
      ts: "2026-06-22T10:00:12.000Z",
      channelState: { state: "sending" },
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:00.000Z",
          thinkingFinishedAt: null,
        },
      },
    });

    expect(wrapper.text()).toContain("00:12");
  });

  it("keeps elapsed time running after refresh when only persisted start remains", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const messageItem = {
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:refreshed-in-flight",
      completedToolLogs: [{ type: "tool_result", text: "still running" }],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:00.000Z",
          thinkingFinishedAt: null,
        },
      },
      turnStatuses: [],
    });

    expect(wrapper.text()).toContain("00:12");
    expect(wrapper.text()).not.toContain("--:--");
  });

  it("does not treat a terminal turn with a missing finish time as running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const messageItem = {
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:terminal-missing-finish",
      dialogProcessId: "dp-terminal-missing-finish",
      completedToolLogs: [{ type: "tool_result", text: "done" }],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:00.000Z",
          thinkingFinishedAt: null,
        },
      },
      turnStatuses: [{
        turnScopeId: messageItem.turnScopeId,
        dialogProcessId: messageItem.dialogProcessId,
        status: "completed",
      }],
    });

    expect(wrapper.text()).toContain("--:--");
  });

  it("updates elapsed time when persisted timing arrives after refresh mount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const messageItem = {
      role: "assistant",
      pending: true,
      turnScopeId: "client-turn:late-refresh-timing",
      channelState: { state: "sending" },
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {},
    });

    expect(wrapper.text()).toContain("--:--");

    await wrapper.setProps({
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:00.000Z",
          thinkingFinishedAt: null,
        },
      },
    });
    await nextTick();

    expect(wrapper.props("turnTimingsByTurnScopeId")?.[messageItem.turnScopeId]?.thinkingStartedAt)
      .toBe("2026-06-22T10:00:00.000Z");

    expect(wrapper.text()).toContain("00:12");
    expect(wrapper.text()).not.toContain("--:--");
  });

  

  it("uses message finish minus start for completed elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:16.000Z"));

    const messageItem = {
      role: "assistant",
      pending: false,
      sessionId: "session-finished",
      turnScopeId: "client-turn-finished",
      ts: "2026-06-22T10:05:00.000Z",
      completedToolLogs: [{ type: "tool_result", text: "done", ts: "2026-06-22T10:05:00.000Z" }],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:00.000Z",
          thinkingFinishedAt: "2026-06-22T10:00:15.000Z",
        },
      },
    });

    expect(wrapper.text()).toContain("00:15");
    expect(wrapper.text()).not.toContain("05:00");
  });

  it("prefers persisted turn timing over stale message timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:30.000Z"));

    const messageItem = {
      role: "assistant",
      pending: false,
      sessionId: "session-refreshed-server-time",
      turnScopeId: "client-turn-refreshed-server-time",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:20.000Z",
      completedToolLogs: [{ type: "tool_result", text: "done", ts: "2026-06-22T10:00:12.000Z" }],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:05.000Z",
          thinkingFinishedAt: "2026-06-22T10:00:12.000Z",
        },
      },
    });

    expect(wrapper.text()).toContain("00:07");
    expect(wrapper.text()).not.toContain("00:20");
  });

  it("uses turn timing start instead of stale message or channel timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:20.000Z"));

    const messageItem = {
      role: "assistant",
      pending: true,
      sessionId: "session-running-channel-time",
      turnScopeId: "client-turn-running-channel-time",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      channelState: {
        state: "sending",
        createdAt: "2026-06-22T10:00:08.000Z",
      },
    };
    const wrapper = mountThinkingPanel(messageItem, {
      turnTimingsByTurnScopeId: {
        [messageItem.turnScopeId]: {
          thinkingStartedAt: "2026-06-22T10:00:05.000Z",
          thinkingFinishedAt: null,
        },
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

    expect(wrapper.text()).toContain("--:--");
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

    expect(wrapper.text()).toContain("--:--");
    expect(wrapper.text()).not.toContain("00:12");
  });

  

  

  

  

  

  
});
