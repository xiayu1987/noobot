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
