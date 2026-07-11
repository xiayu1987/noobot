// Tests split by responsibility from ThinkingPanel.spec.js.
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
