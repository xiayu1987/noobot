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
      },
      resultEvent: {
        eventId: `result-event-${index + 1}`, sequence: sequence + 1, sequenceScopeId: "message-1",
        sequenceDomain: "message-event", authority: "authoritative", timestamp,
      },
    };
  });
}

function taskCheckTimeline(abstract = "目标未漂移") {
  const output = JSON.stringify({
    toolName: "task_check",
    ok: true,
    protocolVersion: 1,
    summary: {
      state: "CONTINUE",
      abstract,
      nextAction: "继续验证",
      contentHash: `sha256:${"a".repeat(64)}`,
    },
  });
  return [{
    key: "call:task-check-1",
    toolCallId: "task-check-1",
    tool: "task_check",
    status: "completed",
    args: { checkContent: "NOOBOT_TASK_CHECK/1" },
    result: output,
    call: {
      eventId: "task-check-call-event",
      sequence: 1,
      sequenceScopeId: "message-task-check",
      sequenceDomain: "message-event",
      authority: "authoritative",
    },
    resultEvent: {
      eventId: "task-check-result-event",
      sequence: 2,
      sequenceScopeId: "message-task-check",
      sequenceDomain: "message-event",
      authority: "authoritative",
    },
  }];
}

describe("ThinkingPanel canonical execution timeline", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("renders persisted canonical tool facts after reload", () => {
    const wrapper = mountThinkingPanel({ role: "assistant", pending: false, toolTimeline: toolTimeline(1) });
    const rows = wrapper.findAll(".execution-log-line");
    expect(rows.map((line) => line.text().split("{")[0])).toEqual([
      "调用：execute · cmd-1", "返回：execute · 已完成",
    ]);
    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(0);
  });

  it("renders the latest strict task_check receipt as a dedicated thinking block", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      toolTimeline: taskCheckTimeline("当前目标清晰且没有偏移"),
    }, { variant: "details" });
    const block = wrapper.find('[data-thinking-block="task-check"]');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain("Task Check");
    expect(block.text()).toContain("当前目标清晰且没有偏移");
  });

  it("does not render task_check data that violates the canonical receipt", () => {
    const timeline = taskCheckTimeline();
    const payload = JSON.parse(timeline[0].result);
    payload.summary.details = "not allowed in receipt";
    timeline[0].result = JSON.stringify(payload);
    const wrapper = mountThinkingPanel({ role: "assistant", pending: false, toolTimeline: timeline });
    expect(wrapper.find('[data-thinking-block="task-check"]').exists()).toBe(false);
  });

  it("reacts to canonical timeline increments after refresh", async () => {
    const messageItem = { role: "assistant", pending: true, toolTimeline: toolTimeline(1) };
    const wrapper = mountThinkingPanel(messageItem, { runtime: { running: true, terminal: false } });
    await wrapper.setProps({ messageItem: { ...messageItem, toolTimeline: toolTimeline(2) } });
    const rows = wrapper.findAll(".execution-log-line").map((line) => line.text());
    expect(rows.filter((row) => row.startsWith("调用：execute"))).toHaveLength(2);
    expect(rows.filter((row) => row.startsWith("返回：execute"))).toHaveLength(2);
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

  it("uses only canonical timelines even if removed legacy fields are present", async () => {
    const wrapper = mountThinkingPanel({
      role: "assistant", pending: false,
      sessionId: "canonical-session", turnScopeId: "canonical-turn",
      presentationMessageId: "canonical-presentation",
      toolTimeline: toolTimeline(1, "canonical"),
      realtimeLogs: [{ event: "tool_call", text: "legacy-live" }],
      completedToolLogs: [{ event: "tool_result", text: "legacy-completed" }],
    });
    await wrapper.findAll(".execution-log-line")[0].trigger("click");
    expect(wrapper.find(".execution-log-detail").text()).toContain("canonical-1");
    expect(wrapper.text()).not.toContain("legacy-live");
    expect(wrapper.text()).not.toContain("legacy-completed");
  });

  it("renders only the latest ten canonical timeline rows", async () => {
    const wrapper = mountThinkingPanel({
      role: "assistant", pending: false,
      sessionId: "window-session", turnScopeId: "window-turn",
      presentationMessageId: "window-presentation",
      toolTimeline: toolTimeline(6),
    });
    const rows = wrapper.findAll(".execution-log-line");
    expect(rows).toHaveLength(10);
    await rows[0].trigger("click");
    expect(wrapper.find(".execution-log-detail").text()).toContain('"command": "cmd-2"');
    await rows[0].trigger("click");
    await rows[9].trigger("click");
    expect(wrapper.find(".execution-log-detail").text()).toContain('"command": "cmd-6"');
  });
});
