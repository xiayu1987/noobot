import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ThinkingPanel from "../../../src/shared/message/ThinkingPanel.vue";

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
          template: "<div><slot /></div>",
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
      realtimeLogs: [],
      completedToolLogs,
    });

    const executionPane = wrapper.findAll(".tab-pane")[0];
    const lines = executionPane.findAll(".execution-log-line");
    expect(lines).toHaveLength(10);
    expect(lines[0].text()).toBe("完成：执行命令：cmd-3");
    expect(lines[9].text()).toBe("完成：执行命令：cmd-12");
    expect(executionPane.attributes("data-label")).toContain("12");
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
    expect(wrapper.findAll(".tab-pane")).toHaveLength(2);
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
      realtimeLogs: [],
      completedToolLogs,
    }, { variant: "details" });

    expect(wrapper.find(".thinking-detail-drawer").exists()).toBe(false);
    expect(wrapper.findAll(".tab-pane")).toHaveLength(0);
    expect(wrapper.find("header").text()).toContain("12");
    expect(wrapper.find("header").text()).not.toContain("({count})");
    const detailLines = wrapper.findAll(".execution-log-line");
    expect(detailLines).toHaveLength(12);
    expect(detailLines[0].text()).toBe("完成：执行命令：cmd-1");
    expect(detailLines[11].text()).toBe("完成：执行命令：cmd-12");
    expect(wrapper.text()).not.toContain("思考明细 ({count})");
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

    const executionPane = wrapper.findAll(".tab-pane")[0];
    const lines = executionPane.findAll(".execution-log-line");

    expect(lines).toHaveLength(10);
    expect(lines[0].text()).toBe("log-3");
    expect(lines[9].text()).toBe("log-12");
    expect(executionPane.attributes("data-label")).toContain("12");
  });

  it("does not backfill injected messages from previous round while current assistant is pending", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        dialogProcessId: "dialog-1",
        messageRoundId: "round-2",
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
            messageRoundId: "round-1",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            content: "previous injected context",
          },
        ],
      },
    );

    expect(wrapper.text()).not.toContain("previous injected context");
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

  it("does not backfill previous round tool logs after current round starts streaming", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: false,
        dialogProcessId: "dialog-1",
        messageRoundId: "round-2",
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
            messageRoundId: "round-1",
            tool_calls: [{ function: { name: "previous_tool" } }],
          },
          {
            role: "tool",
            dialogProcessId: "dialog-1",
            messageRoundId: "round-1",
            content: JSON.stringify({ toolName: "previous_tool", ok: true }),
          },
          {
            role: "tool",
            dialogProcessId: "dialog-1",
            messageRoundId: "round-2",
            content: JSON.stringify({ toolName: "current_tool", ok: true }),
          },
        ],
      },
    );

    expect(wrapper.text()).not.toContain("previous_tool");
    expect(wrapper.text()).toContain("current_tool");
  });
});
