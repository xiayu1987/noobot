/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";
import { clearTurnUiState } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";

function toolTimeline(count = 1, prefix = "cmd") {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index * 2 + 1;
    const toolCallId = `call-${index + 1}`;
    const timestamp = `2026-07-25T01:00:${String(index).padStart(2, "0")}.000Z`;
    return {
      key: `call:${toolCallId}`, toolCallId, tool: "execute", status: "completed",
      args: { command: `${prefix}-${index + 1}` },
      result: { ok: true, command: `${prefix}-${index + 1}` },
      call: {
        eventId: `call-event-${index + 1}`, sequence, sequenceScopeId: "message-1",
        sequenceDomain: "message-event", authority: "authoritative", timestamp,
        log: { event: "tool_call", type: "tool_call", toolCallId, text: `${prefix}-${index + 1}`, timestamp },
      },
      resultEvent: {
        eventId: `result-event-${index + 1}`, sequence: sequence + 1, sequenceScopeId: "message-1",
        sequenceDomain: "message-event", authority: "authoritative", timestamp,
        log: { event: "tool_result", type: "tool_result", toolCallId, text: `${prefix}-${index + 1}`, timestamp },
      },
    };
  });
}

describe("ThinkingPanel canonical execution timeline", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("renders persisted canonical tool facts after reload", () => {
    const wrapper = mountThinkingPanel({ role: "assistant", pending: false, toolTimeline: toolTimeline(1) });
    const rows = wrapper.findAll(".execution-log-line");
    expect(rows.map((line) => line.text().split("{")[0])).toEqual([
      "调用：cmd-1", "返回：cmd-1",
    ]);
    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(0);
  });

  it("reacts to canonical timeline increments after refresh", async () => {
    const messageItem = { role: "assistant", pending: true, toolTimeline: toolTimeline(1) };
    const wrapper = mountThinkingPanel(messageItem, { runtime: { running: true, terminal: false } });
    await wrapper.setProps({ messageItem: { ...messageItem, toolTimeline: toolTimeline(2) } });
    const rows = wrapper.findAll(".execution-log-line").map((line) => line.text());
    expect(rows.some((row) => row.startsWith("调用：cmd-2"))).toBe(true);
    expect(rows.some((row) => row.startsWith("返回：cmd-2"))).toBe(true);
  });

  it("keeps canonical tool detail expandable after a refreshed projection replaces the message", async () => {
    const initialMessage = {
      role: "assistant",
      sessionId: "session-detail-refresh",
      turnScopeId: "turn-detail-refresh",
      presentationMessageId: "presentation-detail-refresh",
      toolTimeline: toolTimeline(1, "canonical-detail"),
    };
    const wrapper = mountThinkingPanel(initialMessage);
    const firstToolRow = wrapper.findAll(".execution-log-line")[0];

    expect(firstToolRow.attributes("data-tool")).toBe("true");
    expect(firstToolRow.attributes("data-expandable")).toBe("true");
    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(0);
    await firstToolRow.trigger("click");
    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(1);
    expect(wrapper.find(".execution-log-detail").text()).toContain('"command": "canonical-detail-1"');

    await wrapper.setProps({
      messageItem: {
        ...initialMessage,
        toolTimeline: toolTimeline(1, "canonical-detail").map((entry) => ({
          ...entry,
          call: { ...entry.call, timestamp: "2026-08-01T12:00:00.000Z" },
        })),
      },
    });

    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(1);

    clearTurnUiState(initialMessage);
    const refreshedWrapper = mountThinkingPanel({
      ...initialMessage,
      toolTimeline: toolTimeline(1, "canonical-detail"),
    });
    expect(refreshedWrapper.findAll(".execution-log-detail")).toHaveLength(0);
  });

  it("uses only canonical timelines even if removed legacy fields are present", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant", pending: false, toolTimeline: toolTimeline(1, "canonical"),
      realtimeLogs: [{ event: "tool_call", text: "legacy-live" }],
      completedToolLogs: [{ event: "tool_result", text: "legacy-completed" }],
    });
    expect(wrapper.text()).toContain("canonical-1");
    expect(wrapper.text()).not.toContain("legacy-live");
    expect(wrapper.text()).not.toContain("legacy-completed");
  });

  it("renders only the latest ten canonical timeline rows", () => {
    const wrapper = mountThinkingPanel({ role: "assistant", pending: false, toolTimeline: toolTimeline(6) });
    const rows = wrapper.findAll(".execution-log-line");
    expect(rows).toHaveLength(10);
    expect(rows[0].text()).toMatch(/^调用：cmd-2/);
    expect(rows[9].text()).toMatch(/^返回：cmd-6/);
  });
});
