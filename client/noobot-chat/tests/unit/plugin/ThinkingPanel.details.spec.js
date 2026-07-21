/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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

  

  

  

  

  

  

  

  

  

  it("uses thinking detail count rather than execution total for detail action label", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      hasThinkingDetails: true,
      thinkingDetailCount: 2,
      executionLogTotal: 9,
      realtimeLogs: [
        { event: "thinking", type: "thinking", text: "plan" },
        { event: "tool_result", type: "tool_result", text: "cmd" },
      ],
    });

    expect(wrapper.find("button").text()).toContain("2");
    expect(wrapper.find("button").text()).not.toContain("9");
  });

  

  it("emits thinking details event from execution process detail button", async () => {
    const completedToolLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_result",
      type: "tool_result",
      text: `cmd-${index + 1}`,
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      depth: 1,
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:detail-button",
      realtimeLogs: [],
      completedToolLogs,
    });

    const detailButton = wrapper.find("button");
    expect(detailButton.text()).toContain("12");
    expect(detailButton.text()).not.toContain("({count})");
    await detailButton.trigger("click");

    expect(wrapper.emitted("open-thinking-details")?.[0]?.[0]).toMatchObject({
      messageItem: { completedToolLogs },
      allMessages: [],
    });
    expect(wrapper.find(".thinking-detail-drawer").exists()).toBe(false);
    expect(wrapper.findAll("el-tab-pane")).toHaveLength(0);
  });

  it("renders thinking entry for summary placeholder without inlined detail logs", async () => {
    const messageItem = {
      role: "assistant",
      pending: false,
      content: "done",
      hasThinkingDetails: true,
      thinkingDetailCount: 5,
    };

    const wrapper = mountThinkingPanel(messageItem);

    expect(wrapper.findAll("el-tab-pane")).toHaveLength(0);
    expect(wrapper.text()).toContain("Expand Thinking");
    expect(wrapper.text()).toContain("Thinking Details (5)");
    expect(wrapper.find("button").text()).toContain("5");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);

    const detailButton = wrapper.find("button");
    await detailButton.trigger("click");

    expect(wrapper.emitted("open-thinking-details")?.[0]?.[0]).toMatchObject({
      messageItem,
      allMessages: [],
    });
  });

  it("shows injected messages from thinking-detail payload by dialogProcessId only", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        dialogProcessId: "dialog-1",
        hasThinkingDetails: true,
        thinkingDetailCount: 1,
        completedToolLogs: [{ event: "tool_call", text: "read_file" }],
      },
      {
        variant: "details",
        allMessages: [
          {
            role: "user",
            dialogProcessId: "dialog-1",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            content: "current injected context without round",
          },
          {
            role: "user",
            dialogProcessId: "dialog-2",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            content: "other dialog injected context",
          },
        ],
      },
    );

    const detailPanes = wrapper.findAll("el-tab-pane");
    expect(detailPanes).toHaveLength(2);
    expect(detailPanes[1].attributes("label")).toContain("Injected Messages (1)");
    expect(wrapper.text()).toContain("current injected context without round");
    expect(wrapper.text()).not.toContain("other dialog injected context");
  });

  it("does not render injected messages as an outer tab in compact panel", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        dialogProcessId: "dialog-1",
        completedToolLogs: [{ event: "tool_call", text: "read_file" }],
      },
      {
        allMessages: [
          {
            role: "user",
            dialogProcessId: "dialog-1",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            content: "outer injected context",
          },
        ],
      },
    );

    expect(wrapper.findAll("el-tab-pane")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("outer injected context");
    expect(wrapper.text()).toContain("Expand Thinking");
  });

  it("renders all thinking logs in details variant without local drawer", () => {
    const completedToolLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_result",
      type: "tool_result",
      text: `cmd-${index + 1}`,
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:details-logs",
      realtimeLogs: [],
      completedToolLogs,
    }, { variant: "details" });

    expect(wrapper.find(".thinking-detail-drawer").exists()).toBe(false);
    const detailPanes = wrapper.findAll("el-tab-pane");
    expect(detailPanes).toHaveLength(2);
    expect(detailPanes[0].attributes("label")).toContain("12");
    expect(detailPanes[0].attributes("label")).not.toContain("({count})");
    const detailLines = wrapper.findAll(".execution-log-line");
    expect(detailLines).toHaveLength(12);
    expect(detailLines[0].text()).toBe("返回：cmd-1");
    expect(detailLines[11].text()).toBe("返回：cmd-12");
    expect(wrapper.text()).not.toContain("思考明细 ({count})");
  });

  it("keeps details tabs header outside the scrollable tab pane bodies", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-turn:details-tabs",
      completedToolLogs: [{ event: "tool_call", text: "read_file" }],
    }, {
      variant: "details",
      allMessages: [
        {
          role: "user",
          dialogProcessId: "dialog-1",
          turnScopeId: "client-turn:details-tabs",
          injectedMessage: true,
          injectedBy: "harness-plugin",
          content: "injected context",
        },
      ],
    });

    expect(wrapper.find(".thinking-details-panel").exists()).toBe(true);
    expect(wrapper.find(".thinking-details-tabs").exists()).toBe(true);

    const panes = wrapper.findAll("el-tab-pane");
    expect(panes).toHaveLength(2);
    expect(panes[0].find(".thinking-details-scroll-body.thinking-details-log-body").exists()).toBe(true);
    expect(panes[1].find(".thinking-details-scroll-body.thinking-details-injected-body").exists()).toBe(true);
    expect(panes[0].find(".execution-log-line").text()).toContain("read_file");
    expect(panes[1].text()).toContain("injected context");
  });

  

  it("does not backfill injected messages while current assistant is pending before streaming starts", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        dialogProcessId: "dialog-1",
        hasFirstStreamEvent: false,
        realtimeLogs: [],
        completedToolLogs: [],
        executionLogTotal: 0,
      },
      {
        allMessages: [
          {
            role: "user",
            dialogProcessId: "dialog-1",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            content: "injected context",
          },
        ],
      },
    );

    expect(wrapper.text()).not.toContain("injected context");
  });

  

  

  

  

  

  it("renders session logs directly without mixing message-derived tool calls", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:tool-call-result",
        completedToolLogs: [
          {
            event: "tool_result",
            type: "tool_result",
            text: "search result ok",
            tool_call_id: "call-1",
          },
        ],
      },
      {
        allMessages: [
          {
            role: "assistant",
            pending: false,
            sessionId: "session-1",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:tool-call-result",
            tool_calls: [
              {
                id: "call-1",
                function: {
                  name: "search",
                  arguments: JSON.stringify({ q: "noobot" }),
                },
              },
            ],
          },
          {
            role: "tool",
            sessionId: "session-1",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:tool-call-result",
            tool_call_id: "call-1",
            content: "search result ok",
          },
        ],
      },
    );

    expect(wrapper.text()).toContain("search result ok");
    expect(wrapper.text()).not.toContain('search({"q":"noobot"})');
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
  });

  it("uses only session logs when alternate message representations exist", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:duplicate-result",
        processCompletedToolLogs: [
          {
            event: "tool_result",
            type: "tool_result",
            text: "read_file ok=true",
            detailText: "full file content",
            toolCallId: "call-duplicate",
            ts: "2026-01-01T00:00:03.000Z",
          },
          {
            event: "tool_result",
            type: "tool_result",
            text: "a differently formatted result",
            tool_call_id: "call-duplicate",
            ts: "2026-01-01T00:00:04.000Z",
          },
        ],
      },
      {
        variant: "details",
        allMessages: [
          {
            role: "assistant",
            sessionId: "session-1",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:duplicate-result",
            tool_calls: [
              {
                id: "call-duplicate",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          {
            role: "tool",
            sessionId: "session-1",
            dialogProcessId: "dialog-1",
            turnScopeId: "client-turn:duplicate-result",
            tool_call_id: "call-duplicate",
            content: "full file content",
            ts: "2026-01-01T00:00:05.000Z",
          },
        ],
      },
    );

    const lines = wrapper.findAll(".execution-log-line");
    expect(lines).toHaveLength(1);
    expect(lines.map((line) => line.text()).join("\n")).toContain("read_file");
    expect(lines.map((line) => line.text()).join("\n")).not.toContain(
      "differently formatted result",
    );
  });

  it("renders tool calls and full tool results in actual timestamp order", async () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:ordered-tools",
        completedToolLogs: [
          { event: "tool_result", type: "tool_result", text: "second result", detailText: "full second result", ts: "2026-01-01T00:00:04.000Z", tool_call_id: "call-2" },
          { event: "tool_call", type: "tool_call", text: "first call", ts: "2026-01-01T00:00:01.000Z", tool_call_id: "call-1" },
          { event: "tool_result", type: "tool_result", text: "first result", detailText: "full first result", ts: "2026-01-01T00:00:02.000Z", tool_call_id: "call-1" },
          { event: "tool_call", type: "tool_call", text: "second call", ts: "2026-01-01T00:00:03.000Z", tool_call_id: "call-2" },
        ],
      },
      { variant: "details" },
    );

    const lines = wrapper.findAll(".execution-log-line");
    expect(lines.map((line) => line.text())).toEqual([
      "调用：first call",
      "返回：first result",
      "调用：second call",
      "返回：second result",
    ]);
  });

  it("excludes unrelated turn scopes while retaining child-process logs", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      dialogProcessId: "main-dialog",
      turnScopeId: "client-turn:timeline",
      completedToolLogs: [
        { event: "tool_result", text: "child result", ts: "2026-01-01T00:00:04.000Z", sessionId: "child", depth: 2, turnScopeId: "child-turn", parentDialogProcessId: "main-dialog" },
        { event: "tool_call", text: "main call", ts: "2026-01-01T00:00:01.000Z", sessionId: "main", depth: 1, turnScopeId: "client-turn:timeline", dialogProcessId: "main-dialog" },
        { event: "tool_call", text: "child call", ts: "2026-01-01T00:00:03.000Z", sessionId: "child", depth: 2, turnScopeId: "child-turn", parentDialogProcessId: "main-dialog" },
        { event: "tool_result", text: "other turn result", ts: "2026-01-01T00:00:02.500Z", sessionId: "main", depth: 1, turnScopeId: "other-turn", dialogProcessId: "other-dialog" },
        { event: "tool_result", text: "main result", ts: "2026-01-01T00:00:02.000Z", sessionId: "main", depth: 1, turnScopeId: "client-turn:timeline", dialogProcessId: "main-dialog" },
      ],
    }, { variant: "details" });

    expect(wrapper.findAll(".thinking-group")).toHaveLength(1);
    expect(wrapper.findAll(".execution-log-line").map((line) => line.text())).toEqual([
      "调用：main call",
      "返回：main result",
      "调用：child call",
      "返回：child result",
    ]);
  });

  

  

  

  
});
