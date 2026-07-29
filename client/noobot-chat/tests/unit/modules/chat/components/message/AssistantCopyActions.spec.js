/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import AssistantCopyActions from "../../../../../../src/modules/chat/components/message/AssistantCopyActions.vue";

function mountActions(props = {}) {
  return mount(AssistantCopyActions, {
    props: {
      visible: true,
      translate: (key) => key,
      onToggleContent: vi.fn(),
      onCopyRich: vi.fn(),
      onCopyText: vi.fn(),
      ...props,
    },
    global: {
      stubs: {
        "el-button": defineComponent({
          name: "ElButton",
          inheritAttrs: false,
          setup(_, { attrs, slots }) {
            return () => h("button", attrs, slots.default?.());
          },
        }),
        "el-icon": defineComponent({
          name: "ElIcon",
          setup(_, { slots }) {
            return () => h("span", slots.default?.());
          },
        }),
        "el-tooltip": defineComponent({
          name: "ElTooltip",
          props: { content: { type: String, default: "" } },
          setup(tooltipProps, { slots }) {
            return () => h("span", { title: tooltipProps.content }, slots.default?.());
          },
        }),
      },
    },
  });
}

describe("AssistantCopyActions", () => {
  it("toggles from the entire action row and exposes expansion state", async () => {
    const onToggleContent = vi.fn();
    const wrapper = mountActions({ contentExpanded: false, onToggleContent });

    expect(wrapper.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("message.expand");
    await wrapper.trigger("click");
    await wrapper.trigger("keydown", { key: "Enter" });

    expect(onToggleContent).toHaveBeenCalledTimes(2);
  });

  it("keeps copy actions independent from row toggling", async () => {
    const onToggleContent = vi.fn();
    const onCopyRich = vi.fn();
    const onCopyText = vi.fn();
    const wrapper = mountActions({ onToggleContent, onCopyRich, onCopyText });
    const buttons = wrapper.findAllComponents({ name: "ElButton" });

    expect(buttons[0].attributes("aria-label")).toBe("message.copyFormat");
    expect(buttons[1].attributes("aria-label")).toBe("message.copyText");

    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await buttons[0].trigger("keydown", { key: "Enter" });

    expect(onCopyRich).toHaveBeenCalledOnce();
    expect(onCopyText).toHaveBeenCalledOnce();
    expect(onToggleContent).not.toHaveBeenCalled();
  });
});
