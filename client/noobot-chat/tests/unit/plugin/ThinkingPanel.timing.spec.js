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

  

  

  

  

  

  
});
