/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

describe("ThinkingPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });



  it("does not reuse a persisted turn start from another session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:12.000Z"));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      sessionId: "session-current",
      turnScopeId: "client-turn-same-id",
      ts: "2026-06-22T10:00:12.000Z",
      channelState: { state: "sending" },
    });

    expect(wrapper.find(".thinking-duration").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("--:--");
    expect(wrapper.text()).not.toContain("00:12");
  });









  it("migrates the isolated process projection without mixing legacy fields", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      processRealtimeLogs: [{ event: "tool_result", type: "tool_result", text: "process-live" }],
      processCompletedToolLogs: [{ event: "tool_result", type: "tool_result", text: "process-done" }],
      processExecutionLogTotal: 6,
      realtimeLogs: [{ event: "tool_result", type: "tool_result", text: "legacy-live" }],
      completedToolLogs: [{ event: "tool_result", type: "tool_result", text: "legacy-done" }],
      executionLogTotal: 1,
    });

    expect(wrapper.find(".execution-log-line").text()).toContain("process-live");
    expect(wrapper.text()).not.toContain("legacy-live");
    expect(wrapper.find("button").text()).toContain("2");
  });

  it("uses replayed legacy logs when the refreshed process projection is still empty", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      sessionId: "session-refreshed",
      turnScopeId: "client-turn:refreshed",
      processRealtimeLogs: [
        {
          event: "guidance_analysis_response",
          type: "guidance_analysis",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          text: "internal analysis",
        },
      ],
      processExecutionLogTotal: 0,
      realtimeLogs: [
        { event: "tool_call", type: "tool_call", text: "replayed tool call" },
      ],
      executionLogTotal: 1,
    }, {
      runtime: {
        running: true,
        terminal: false,
        startedAt: "2026-07-22T01:25:00.000Z",
        finishedAt: "",
      },
    });

    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("replayed tool call");
    expect(wrapper.find(".empty-hint").exists()).toBe(false);
  });

  it("keeps rendering live rows received after a refreshed detail snapshot", async () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      sessionId: "session-live-after-refresh",
      turnScopeId: "client-turn:live-after-refresh",
      processRealtimeLogs: [],
      realtimeLogs: [],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      runtime: {
        running: true,
        terminal: false,
        startedAt: "2026-07-22T01:25:00.000Z",
        finishedAt: "",
      },
    });

    await wrapper.setProps({
      messageItem: {
        ...messageItem,
        realtimeLogs: [
          { event: "tool_call", type: "tool_call", text: "live row after refresh" },
        ],
        executionLogTotal: 1,
      },
    });

    expect(wrapper.find(".execution-log-line").text()).toContain("live row after refresh");
    expect(wrapper.find(".empty-hint").exists()).toBe(false);
  });







  it("shows only latest ten completed tool logs in execution process after reload", () => {
    const completedToolLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_result",
      type: "tool_result",
      text: `cmd-${index + 1}`,
      ts: `2026-06-16T00:00:${String(index).padStart(2, "0")}Z`,
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:completed-list",
      realtimeLogs: [],
      completedToolLogs,
    });
    const lines = wrapper.findAll(".execution-log-line");
    expect(lines).toHaveLength(10);
    expect(lines[0].text()).toBe("返回：cmd-3");
    expect(lines[9].text()).toBe("返回：cmd-12");
    expect(wrapper.find("button").text()).toContain("12");
  });













  it("shows cumulative execution count while rendering only latest ten realtime logs", () => {
    const realtimeLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "thinking",
      type: "thinking",
      text: `log-${index + 1}`,
      ts: `2026-06-16T00:00:${String(index).padStart(2, "0")}Z`,
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      realtimeLogs,
      executionLogTotal: 12,
      completedToolLogs: [],
    });

    const lines = wrapper.findAll(".execution-log-line");

    expect(lines).toHaveLength(10);
    expect(lines[0].text()).toBe("log-3");
    expect(lines[9].text()).toBe("log-12");
    expect(wrapper.find("button").text()).toContain("0");
  });

  it("orders cross-domain activity and tool facts by timestamp instead of sequence", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      turnScopeId: "client-turn:cross-domain-order",
      activityTimeline: [
        {
          activityId: "activity:transport-999",
          eventId: "transport-999",
          sequence: 999,
          authority: "compatibility",
          sequenceDomain: "transport",
          timestamp: "2026-07-25T01:00:00.000Z",
          log: {
            event: "thinking",
            type: "thinking",
            text: "earlier transport activity",
            timestamp: "2026-07-25T01:00:00.000Z",
          },
        },
      ],
      toolTimeline: [
        {
          key: "call:message-30",
          toolCallId: "message-30",
          status: "running",
          call: {
            eventId: "message-30",
            sequence: 30,
            authority: "authoritative",
            sequenceDomain: "message",
            timestamp: "2026-07-25T01:00:01.000Z",
            log: {
              event: "tool_call",
              type: "tool_call",
              toolCallId: "message-30",
              text: "later message tool",
              timestamp: "2026-07-25T01:00:01.000Z",
            },
          },
        },
      ],
    });

    const lines = wrapper.findAll(".execution-log-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].text()).toContain("earlier transport activity");
    expect(lines[1].text()).toContain("later message tool");
  });



  it("does not backfill previous tool logs while current assistant is pending", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        dialogProcessId: "dialog-1",
        realtimeLogs: [],
        completedToolLogs: [],
        executionLogTotal: 0,
      },
      {
        allMessages: [
          {
            role: "assistant",
            pending: false,
            dialogProcessId: "dialog-1",
            tool_calls: [{ function: { name: "previous_tool" } }],
          },
          {
            role: "tool",
            dialogProcessId: "dialog-1",
            content: JSON.stringify({ toolName: "previous_tool", ok: true }),
          },
        ],
      },
    );

    expect(wrapper.text()).not.toContain("previous_tool");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);
  });

  it("can render isolated legacy history without using dialogProcessId for turn ownership", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      dialogProcessId: "dialog-reused",
      completedToolLogs: [
        { event: "tool_call", type: "tool_call", text: "previous completed tool" },
      ],
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "previous process tool" },
      ],
    });

    expect(wrapper.text()).not.toContain("previous completed tool");
    expect(wrapper.text()).toContain("previous process tool");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
  });

  it("renders completed tool logs after assistant turnScopeId is persisted", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:current",
      dialogProcessId: "dialog-current",
      completedToolLogs: [
        { event: "tool_call", type: "tool_call", text: "current completed tool" },
      ],
    });

    expect(wrapper.text()).toContain("current completed tool");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
  });



  it("shows tool logs for the same dialogProcessId after current dialog starts streaming", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:streaming",
        realtimeLogs: [],
        completedToolLogs: [],
        executionLogTotal: 0,
      },
      {
        allMessages: [
          {
            role: "assistant",
            pending: false,
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:streaming",
            tool_calls: [{ function: { name: "previous_tool" } }],
          },
          {
            role: "tool",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:streaming",
            content: JSON.stringify({ toolName: "previous_tool", ok: true }),
          },
          {
            role: "tool",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:streaming",
            content: JSON.stringify({ toolName: "current_tool", ok: true }),
          },
        ],
      },
    );

    expect(wrapper.text()).toContain("previous_tool");
    expect(wrapper.text()).toContain("current_tool");
  });










});
