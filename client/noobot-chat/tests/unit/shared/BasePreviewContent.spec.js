/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import BasePreviewContent from "../../../src/shared/ui/BasePreviewContent.vue";

vi.mock("../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({ translate: (key = "") => key }),
}));

vi.mock("../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

function mountPreview(props = {}) {
  return mount(BasePreviewContent, {
    props: {
      active: true,
      previewMode: "markdown",
      previewTextContent: "# Preview",
      renderMarkdown: (content = "") => `<h1>${content}</h1>`,
      ...props,
    },
    global: {
      directives: { loading: () => {} },
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

describe("BasePreviewContent", () => {
  it("uses the main-message icon and tooltip pattern for both copy actions", async () => {
    const wrapper = mountPreview();
    const tooltips = wrapper.findAllComponents({ name: "ElTooltip" });
    const buttons = wrapper.findAllComponents({ name: "ElButton" });

    expect(tooltips.map((tooltip) => tooltip.props("content"))).toEqual([
      "message.copyFormat",
      "message.copyText",
    ]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].classes()).toContain("noobot-flat-inline-icon-btn");
    expect(buttons[1].classes()).toContain("noobot-flat-inline-icon-btn");
    expect(buttons[0].attributes("aria-label")).toBe("message.copyFormat");
    expect(buttons[1].attributes("aria-label")).toBe("message.copyText");
    expect(wrapper.text()).not.toContain("message.copyFormat");
    expect(wrapper.text()).not.toContain("message.copyText");

    await buttons[0].trigger("click");
    await buttons[1].trigger("click");

    expect(wrapper.emitted("copy-markdown-rich")?.[0]?.[0]).toContain("<h1># Preview</h1>");
    expect(wrapper.emitted("copy-markdown-text")).toHaveLength(1);
  });

  it("does not show copy actions outside a successful markdown preview", () => {
    const wrapper = mountPreview({ previewMode: "text" });

    expect(wrapper.findAllComponents({ name: "ElButton" })).toHaveLength(0);
  });
});
