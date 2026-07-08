import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThinkingPanel from "../../../src/shared/message/ThinkingPanel.vue";

vi.mock("../../../src/shared/ui", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    BaseThinkingPanelShell: defineComponent({
      name: "BaseThinkingPanelShell",
      setup(_, { slots }) {
        return () => h("section", [slots.title?.(), slots.default?.(), slots.footer?.()]);
      },
    }),
    BaseTabPanelBody: defineComponent({
      name: "BaseTabPanelBody",
      setup(_, { slots }) {
        return () => h("div", { class: "tab-body" }, slots.default?.());
      },
    }),
    BaseThinkingLogLine: defineComponent({
      name: "BaseThinkingLogLine",
      props: ["eventText", "contentText"],
      setup(props) {
        return () => h("div", { class: "execution-log-line" }, props.contentText);
      },
    }),
    BaseSectionHeader: defineComponent({
      name: "BaseSectionHeader",
      props: ["title"],
      setup(props, { slots }) {
        return () => h("header", [h("span", props.title), slots.extra?.()]);
      },
    }),
    BaseEmptyHint: defineComponent({
      name: "BaseEmptyHint",
      props: ["text"],
      setup(props) {
        return () => h("p", { class: "empty-hint" }, props.text);
      },
    }),
    BaseMetaLabel: defineComponent({
      name: "BaseMetaLabel",
      props: ["text"],
      setup(props) {
        return () => h("div", { class: "meta-label" }, props.text);
      },
    }),
    BaseNoteBlock: defineComponent({
      name: "BaseNoteBlock",
      props: ["title", "content"],
      setup(props) {
        return () => h("article", [h("h4", props.title), h("p", props.content)]);
      },
    }),
    BasePillButton: defineComponent({
      name: "BasePillButton",
      props: ["label"],
      emits: ["click"],
      setup(props, { slots, emit }) {
        return () => h("button", { onClick: () => emit("click") }, [slots.default?.(), props.label]);
      },
    }),
  };
});

function mountThinkingPanel(messageItem, props = {}) {
  return mount(ThinkingPanel, {
    props: {
      messageItem,
      allMessages: [],
      ...props,
    },
    global: {
      stubs: {
        BaseThinkingPanelShell: {
          template: '<section><slot name="title" /><slot /><slot name="footer" /></section>',
        },
        "el-tabs": {
          template: "<div class=\"tabs\"><slot /></div>",
        },
        ElTabs: {
          template: "<div class=\"tabs\"><slot /></div>",
        },
        ElTabPane: {
          props: ["label"],
          template: '<div class="tab-pane" :data-label="label"><slot /></div>',
        },
        "el-tab-pane": {
          props: ["label"],
          template: '<div class="tab-pane" :data-label="label"><slot /></div>',
        },
        "el-drawer": {
          props: ["modelValue", "title", "size"],
          template: '<aside v-if="modelValue" class="thinking-detail-drawer" :data-title="title" :data-size="size"><slot /></aside>',
        },
        BaseTabPanelBody: {
          template: '<div class="tab-body"><slot /></div>',
        },
        BaseThinkingLogLine: {
          props: ["eventText", "contentText"],
          template: '<div class="execution-log-line">{{ contentText }}</div>',
        },
        BaseSectionHeader: {
          props: ["title"],
          template: '<header><span>{{ title }}</span><slot name="extra" /></header>',
        },
        BaseEmptyHint: {
          props: ["text"],
          template: '<p class="empty-hint">{{ text }}</p>',
        },
        BaseMetaLabel: {
          props: ["text"],
          template: '<div class="meta-label">{{ text }}</div>',
        },
        BaseNoteBlock: {
          props: ["title", "content"],
          template: '<article><h4>{{ title }}</h4><p>{{ content }}</p></article>',
        },
        BasePillButton: {
          props: ["label"],
          template: '<button><slot />{{ label }}</button>',
        },
      },
    },
  });
}

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

    expect(wrapper.text()).toContain("00:00");
    expect(wrapper.text()).not.toContain("00:12");
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

  it("prefers process-derived execution fields while keeping legacy fallback", () => {
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
    expect(wrapper.find("button").text()).toContain("1");
  });

  it("renders latest guidance analysis above execution logs without mixing it into rolling tool logs", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      processRealtimeLogs: [
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old analysis\nline two",
          text: "old analysis\nline two",
        },
        { event: "tool_call", type: "tool_call", text: "read_file" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest analysis\nkeep newline",
          text: "latest analysis\nkeep newline",
        },
        { event: "tool_result", type: "tool_result", text: "read_file done" },
      ],
    });

    const analysisBlock = wrapper.find(".thinking-analysis-block");
    expect(analysisBlock.exists()).toBe(true);
    expect(analysisBlock.text()).toContain("latest analysis\nkeep newline");
    expect(analysisBlock.text()).not.toContain("old analysis");

    const rollingLogs = wrapper.findAll(".execution-log-line").map((line) => line.text());
    expect(rollingLogs).toEqual(["开始：执行命令：read_file", "完成：执行命令：read_file done"]);
  });

  it("does not render non-guidance analysis logs in the dedicated analysis block", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      processRealtimeLogs: [
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "summary",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "summary analysis should stay hidden",
          text: "summary analysis should stay hidden",
        },
        { event: "tool_call", type: "tool_call", text: "execute_script" },
      ],
    });

    expect(wrapper.find(".thinking-analysis-block").exists()).toBe(false);
    expect(wrapper.findAll(".execution-log-line").map((line) => line.text())).toEqual([
      "开始：执行命令：execute_script",
    ]);
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
    expect(lines[0].text()).toBe("完成：执行命令：cmd-3");
    expect(lines[9].text()).toBe("完成：执行命令：cmd-12");
    expect(wrapper.find("button").text()).toContain("12");
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

  it("does not render completed tool logs before assistant turnScopeId is persisted", () => {
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
    expect(wrapper.text()).not.toContain("previous process tool");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);
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

  it("does not render plugin capability responses as guidance analysis", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      turnScopeId: "client-turn:plugin-analysis",
      processExecutionLogTotal: 5,
      processRealtimeLogs: [
        { event: "tool_call", type: "tool_call", text: "tool log" },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          text: "planning response",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old guidance analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "old planning analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "planning",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest planning analysis",
        },
        {
          event: "plugin_capability_response",
          type: "plugin_capability_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "latest guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).not.toContain("分析流程");
    expect(wrapper.text()).not.toContain("模型返回");
    expect(wrapper.text()).not.toContain("latest guidance analysis");
    expect(wrapper.text()).not.toContain("old planning analysis");
    expect(wrapper.text()).not.toContain("latest planning analysis");
    expect(wrapper.text()).not.toContain("planning response");
    expect(wrapper.text()).not.toContain("old guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.findAll(".execution-log-line")[0].text()).toContain("tool log");
    expect(wrapper.find("button").text()).toContain("1");
  });

  it("renders latest guidance analysis response from completed logs after reload", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:plugin-completed",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          output: "completed guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("completed guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });

  it("renders guidance analysis from normalized data fields", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:plugin-data-fields",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis_response",
          type: "guidance_analysis_response",
          data: {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
            output: "data field guidance analysis",
          },
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("data field guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });

  it("keeps old completed guidance analysis visible after reload", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: false,
      turnScopeId: "client-turn:old-harness-completed",
      processCompletedToolLogs: [
        { event: "tool_result", type: "tool_result", text: "completed tool" },
        {
          event: "guidance_analysis",
          type: "guidance_analysis",
          rawEvent: "guidance_analysis_response",
          purpose: "guidance",
          harnessFlow: "analysis",
          chain: "auxiliary",
          output: "old completed guidance analysis",
        },
      ],
    });

    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("old completed guidance analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    expect(wrapper.find(".execution-log-line").text()).toContain("completed tool");
  });
});
