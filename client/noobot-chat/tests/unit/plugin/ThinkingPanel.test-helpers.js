/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import ThinkingPanel from "../../../src/shared/message/ThinkingPanel.vue";

// Node exposes an unavailable localStorage getter unless a backing file is
// configured. Keep component tests deterministic and browser-like.
if (!globalThis.localStorage?.getItem) {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
      setItem: (key, value) => values.set(String(key), String(value)),
      removeItem: (key) => values.delete(String(key)),
      clear: () => values.clear(),
    },
  });
}

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

export function mountThinkingPanel(messageItem, props = {}) {
  return mount(ThinkingPanel, {
    props: { messageItem, allMessages: [], ...props },
    global: {
      stubs: {
        BaseThinkingPanelShell: { template: '<section><slot name="title" /><slot /><slot name="footer" /></section>' },
        "el-tabs": { template: '<div class="tabs"><slot /></div>' },
        ElTabs: { template: '<div class="tabs"><slot /></div>' },
        ElTabPane: { props: ["label"], template: '<div class="tab-pane" :data-label="label"><slot /></div>' },
        "el-tab-pane": { props: ["label"], template: '<div class="tab-pane" :data-label="label"><slot /></div>' },
        "el-drawer": {
          props: ["modelValue", "title", "size"],
          template: '<aside v-if="modelValue" class="thinking-detail-drawer" :data-title="title" :data-size="size"><slot /></aside>',
        },
        BaseTabPanelBody: { template: '<div class="tab-body"><slot /></div>' },
        BaseThinkingLogLine: { props: ["eventText", "contentText"], template: '<div class="execution-log-line">{{ contentText }}</div>' },
        BaseSectionHeader: { props: ["title"], template: '<header><span>{{ title }}</span><slot name="extra" /></header>' },
        BaseEmptyHint: { props: ["text"], template: '<p class="empty-hint">{{ text }}</p>' },
        BaseMetaLabel: { props: ["text"], template: '<div class="meta-label">{{ text }}</div>' },
        BaseNoteBlock: { props: ["title", "content"], template: '<article><h4>{{ title }}</h4><p>{{ content }}</p></article>' },
        BasePillButton: { props: ["label"], template: '<button><slot />{{ label }}</button>' },
      },
    },
  });
}
