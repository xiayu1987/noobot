/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";
import { buildViewMessage } from "../../../../../../src/modules/chat/model/messageModel.js";
import {
  clearTurnUiState,
  getTurnUiState,
  setTurnThinkingOpenNames,
} from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";

function runtime(overrides = {}) {
  return {
    running: false,
    terminal: false,
    canStop: false,
    phase: "idle",
    startedAt: "",
    finishedAt: "",
    ...overrides,
  };
}

function thinkingMessage(overrides = {}) {
  return {
    role: "assistant",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    activityTimeline: [{
      activityId: "event:thinking-1", eventId: "thinking-1", event: "thinking", type: "thinking",
      sequence: 1, sequenceScopeId: "message-1", sequenceDomain: "message-event",
      authority: "authoritative", text: "thinking", output: "thinking",
    }],
    ...overrides,
  };
}

describe("ThinkingPanel runtime timing", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("uses the Runtime Store start time while running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const wrapper = mountThinkingPanel(thinkingMessage({ pending: false }), {
      runtime: runtime({ running: true, phase: "processing", startedAt: "2026-06-22T10:00:00.000Z" }),
    });
    expect(wrapper.text()).toContain("00:12");
    expect(wrapper.find(".thinking-realtime-shell").classes()).toContain("is-running");
  });

  it("uses Runtime Store start and finish time after completion", () => {
    const wrapper = mountThinkingPanel(thinkingMessage(), {
      runtime: runtime({ terminal: true, phase: "completed", startedAt: "2026-06-22T10:00:00.000Z", finishedAt: "2026-06-22T10:00:15.000Z" }),
    });
    expect(wrapper.text()).toContain("00:15");
    expect(wrapper.find(".thinking-realtime-shell").classes()).not.toContain("is-running");
  });

  it("uses the hydrated Registry timing for an older turn", () => {
    const wrapper = mountThinkingPanel(thinkingMessage({
      turnScopeId: "client-turn:history:1",
      pending: false,
    }), {
      runtime: runtime({
        terminal: true,
        startedAt: "2026-07-24T10:00:00.000Z",
        finishedAt: "2026-07-24T10:00:12.000Z",
      }),
    });

    expect(wrapper.text()).toContain("00:12");
    expect(wrapper.text()).not.toContain("--:--");
  });

  it("reacts when the selected Runtime Store view completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const wrapper = mountThinkingPanel(thinkingMessage(), {
      runtime: runtime({ running: true, phase: "processing", startedAt: "2026-06-22T10:00:00.000Z" }),
    });
    expect(wrapper.text()).toContain("00:12");
    await wrapper.setProps({
      runtime: runtime({ terminal: true, phase: "completed", startedAt: "2026-06-22T10:00:00.000Z", finishedAt: "2026-06-22T10:00:07.000Z" }),
    });
    await nextTick();
    expect(wrapper.text()).toContain("00:07");
    expect(wrapper.find(".thinking-realtime-shell").classes()).not.toContain("is-running");
  });

  it("keeps the expanded Turn UI state through a non-terminal refresh transition", async () => {
    const message = thinkingMessage({ pending: true });
    clearTurnUiState(message);
    const wrapper = mountThinkingPanel(message, {
      runtime: runtime({ running: true, phase: "processing" }),
    });
    setTurnThinkingOpenNames(message, ["thinking-panel"]);

    await wrapper.setProps({
      runtime: runtime({ running: false, terminal: null, phase: "hydrating" }),
    });
    await nextTick();
    expect(getTurnUiState(message).thinkingOpenNames).toEqual(["thinking-panel"]);

    await wrapper.setProps({
      runtime: runtime({ running: true, terminal: null, phase: "processing" }),
    });
    await nextTick();
    expect(getTurnUiState(message).thinkingOpenNames).toEqual(["thinking-panel"]);
    wrapper.unmount();
    clearTurnUiState(message);
  });

  it("collapses the expanded Turn UI state only after an authoritative terminal", async () => {
    const message = thinkingMessage({ turnScopeId: "turn-terminal" });
    clearTurnUiState(message);
    const wrapper = mountThinkingPanel(message, {
      runtime: runtime({ running: true, phase: "processing" }),
    });
    setTurnThinkingOpenNames(message, ["thinking-panel"]);

    await wrapper.setProps({
      runtime: runtime({ running: false, terminal: "completed", phase: "completed" }),
    });
    await nextTick();
    expect(getTurnUiState(message).thinkingOpenNames).toEqual([]);
    wrapper.unmount();
    clearTurnUiState(message);
  });

  it("shows an unknown duration when Runtime Store has no timestamps", () => {
    const wrapper = mountThinkingPanel(thinkingMessage(), { runtime: runtime({ terminal: true, phase: "completed" }) });
    expect(wrapper.text()).toContain("--:--");
  });

  it("does not infer runtime or timing from pending message fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));
    const wrapper = mountThinkingPanel(thinkingMessage({
      pending: true,
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      channelState: { state: "sending", createdAt: "2026-06-22T10:00:00.000Z" },
    }));
    expect(wrapper.text()).toContain("--:--");
    expect(wrapper.text()).not.toContain("00:12");
    const shell = wrapper.find(".thinking-realtime-shell");
    expect(shell.exists()).toBe(true);
    expect(shell.classes()).not.toContain("is-running");
  });

  it("does not infer a running thinking panel from legacy workflow message fields", () => {
    const wrapper = mountThinkingPanel(buildViewMessage(thinkingMessage({
      activityTimeline: [],
      pending: true,
      workflowNodeRunningPlaceholder: true,
    })));

    expect(wrapper.find(".thinking-realtime-shell").exists()).toBe(false);
  });

  it("prefers Runtime Store timestamps over stale message and channel timestamps", () => {
    const wrapper = mountThinkingPanel(thinkingMessage({
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:20.000Z",
      channelState: { createdAt: "2026-06-22T10:00:01.000Z" },
    }), {
      runtime: runtime({ terminal: true, phase: "completed", startedAt: "2026-06-22T10:00:05.000Z", finishedAt: "2026-06-22T10:00:12.000Z" }),
    });
    expect(wrapper.text()).toContain("00:07");
    expect(wrapper.text()).not.toContain("00:20");
  });

  it("renders a workflow child terminal Runtime Store view without identity fallback", () => {
    const wrapper = mountThinkingPanel(thinkingMessage({
      sessionId: "workflow-child-session",
      turnScopeId: "workflow-node_client-turn_a1",
    }), {
      runtime: runtime({ terminal: true, phase: "completed", startedAt: "2026-06-22T10:00:05.000Z", finishedAt: "2026-06-22T10:00:12.000Z" }),
    });
    expect(wrapper.text()).toContain("00:07");
    expect(wrapper.find(".thinking-realtime-shell").classes()).not.toContain("is-running");
  });
});
