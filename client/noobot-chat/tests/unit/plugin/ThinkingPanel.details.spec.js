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
    expect(detailLines[0].text()).toBe("完成：执行命令：cmd-1");
    expect(detailLines[11].text()).toBe("完成：执行命令：cmd-12");
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

  

  

  

  

  

  it("renders persisted tool calls together with completed tool results in thinking details", () => {
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

    expect(wrapper.text()).toContain('search({"q":"noobot"})');
    expect(wrapper.text()).toContain("search result ok");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(2);
  });

  

  

  

  
});
