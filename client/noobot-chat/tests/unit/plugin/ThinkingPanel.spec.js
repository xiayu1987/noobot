import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ThinkingPanel from "../../../../../plugin/noobot-plugin-harness/frontend/components/ThinkingPanel.vue";

function mountThinkingPanel(messageItem) {
  return mount(ThinkingPanel, {
    props: {
      messageItem,
      allMessages: [],
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
          template: '<button>{{ label }}</button>',
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

  it("keeps all completed tool logs in thinking details", () => {
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

    const detailLines = wrapper.findAll(".tab-pane")[1].findAll(".execution-log-line");
    expect(detailLines).toHaveLength(12);
    expect(detailLines[0].text()).toBe("完成：执行命令：cmd-1");
    expect(detailLines[11].text()).toBe("完成：执行命令：cmd-12");
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
});
