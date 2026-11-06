/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { describeFilePreview } from "@noobot/attachment-protocol/preview";
import BasePreviewContent from "../../../src/shared/ui/BasePreviewContent.vue";

vi.mock("../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({ translate: (key = "") => key }),
}));

vi.mock("../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

function mountPreview({ name = "preview.md", ...props } = {}) {
  return mount(BasePreviewContent, {
    props: {
      active: true,
      descriptor: describeFilePreview({ name }),
      textContent: "# Preview",
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
  it("uses the authoritative MIME-derived language for an extensionless file", async () => {
    const wrapper = mountPreview({
      name: "payload",
      descriptor: describeFilePreview({ name: "payload", mimeType: "application/json" }),
      textContent: '{"answer":42}',
    });
    await vi.waitFor(() => expect(wrapper.find(".hljs-number").text()).toBe("42"));
    wrapper.unmount();
  });

  it("stops oversized table rendering and preserves access to its complete source", async () => {
    const textContent = ",".repeat(1048575);
    const wrapper = mountPreview({ name: "large.csv", textContent });
    await flushPromises();
    expect(wrapper.find(".preview-error").exists()).toBe(true);
    expect(wrapper.findAll("td")).toHaveLength(0);
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    expect(wrapper.find("pre").text()).toBe(textContent);
    wrapper.unmount();
  });

  it("loads Markdown resources once per document and reuses them across tabs", async () => {
    const resolveResource = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const wrapper = mountPreview({
      textContent: "![image](./images/a.png)",
      renderMarkdown: undefined,
      resolveResource,
    });
    await vi.waitFor(() =>
      expect(wrapper.find("img").attributes("src")).toMatch(/^data:image\/png;base64,/),
    );
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    await flushPromises();
    expect(resolveResource).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("keeps malformed formatted content readable in the source tab", async () => {
    const wrapper = mountPreview({ name: "bad.json", textContent: "{invalid" });
    await flushPromises();
    expect(wrapper.find(".preview-error").exists()).toBe(true);
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    expect(wrapper.find(".preview-error").exists()).toBe(false);
    expect(wrapper.find("pre").text()).toBe("{invalid");
    wrapper.unmount();
  });

  it("renders HTML resources as data URIs and preserves the cached document on tab changes", async () => {
    const resolveResource = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const wrapper = mountPreview({
      name: "page.html",
      textContent: '<img src="image.png">',
      resolveResource,
    });
    await vi.waitFor(() =>
      expect(wrapper.find("iframe").attributes("srcdoc")).toContain("data:image/png;base64,"),
    );
    const frame = wrapper.find("iframe");
    expect(frame.attributes("sandbox")).toBe("");
    expect(frame.attributes("referrerpolicy")).toBe("no-referrer");
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    expect(wrapper.find("iframe").exists()).toBe(false);
    await wrapper.setProps({ textContent: '<h1>Edited</h1><img src="image.png">' });
    expect(resolveResource).toHaveBeenCalledTimes(1);
    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    await vi.waitFor(() => expect(wrapper.find("iframe").attributes("srcdoc")).toContain("Edited"));
    expect(resolveResource).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("restores video position and playback state when its resource ticket changes", async () => {
    const wrapper = mountPreview({ name: "clip.mp4", url: "/first" });
    const video = wrapper.find("video");
    Object.defineProperty(video.element, "paused", { value: false, configurable: true });
    video.element.currentTime = 42;
    const play = vi.spyOn(video.element, "play").mockResolvedValue();
    await wrapper.setProps({ url: "/renewed" });
    video.element.currentTime = 0;
    await video.trigger("loadedmetadata");
    expect(video.element.currentTime).toBe(42);
    expect(play).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("mounts HTML frames only after resources are ready and ignores an abandoned document", async () => {
    let finishResource;
    const resolveResource = vi.fn(
      () =>
        new Promise((resolve) => {
          finishResource = resolve;
        }),
    );
    const wrapper = mountPreview({
      name: "page.html",
      textContent: '<img src="slow.png"><h1>Old</h1>',
      resolveResource,
    });
    expect(resolveResource).toHaveBeenCalledOnce();
    expect(wrapper.find("iframe").exists()).toBe(false);
    await flushPromises();
    expect(wrapper.attributes("aria-busy")).toBe("true");
    await wrapper.setProps({ textContent: "<h1>New</h1>" });
    await flushPromises();
    expect(wrapper.attributes("aria-busy")).toBe("false");
    expect(wrapper.find("iframe").attributes("srcdoc")).toContain("<h1>New</h1>");
    finishResource(new Blob(["image"]));
    await flushPromises();
    expect(wrapper.find("iframe").attributes("srcdoc")).not.toContain("<h1>Old</h1>");
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    await wrapper.findAll('[role="tab"]')[0].trigger("click");
    await flushPromises();
    expect(wrapper.find("iframe").attributes("srcdoc")).toContain("<h1>New</h1>");
    wrapper.unmount();
  });

  it("highlights code and preserves source markup as text", async () => {
    const wrapper = mountPreview({
      name: "code.js",
      textContent: 'const value = "<img onerror=alert(1)>";',
    });
    await vi.waitFor(() => expect(wrapper.find(".hljs-keyword").text()).toBe("const"));
    expect(wrapper.find("img").exists()).toBe(false);
    await wrapper.findAll('[role="tab"]')[1].trigger("click");
    expect(wrapper.find("pre").text()).toContain("<img onerror=alert(1)>");
    wrapper.unmount();
  });

  it("uses the main-message icon and tooltip pattern for both copy actions", async () => {
    const wrapper = mountPreview();
    const tooltips = wrapper.findAllComponents({ name: "ElTooltip" });
    const buttons = wrapper.findAllComponents({ name: "ElButton" });

    expect(tooltips.map((tooltip) => tooltip.props("content"))).toEqual([
      "message.copyFormat",
      "message.copyText",
    ]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].classes()).toContain("noobot-icon-button");
    expect(buttons[1].classes()).toContain("noobot-icon-button");
    expect(buttons[0].classes()).toContain("noobot-flat-inline-icon-btn");
    expect(buttons[1].classes()).toContain("noobot-flat-inline-icon-btn");
    expect(buttons[0].classes()).toContain("noobot-copy-button");
    expect(buttons[1].classes()).toContain("noobot-copy-button");
    expect(buttons[0].attributes("aria-label")).toBe("message.copyFormat");
    expect(buttons[1].attributes("aria-label")).toBe("message.copyText");
    expect(wrapper.text()).not.toContain("message.copyFormat");
    expect(wrapper.text()).not.toContain("message.copyText");

    await buttons[0].trigger("click");
    await buttons[1].trigger("click");

    expect(wrapper.emitted("copy-markdown-rich")).toEqual([[]]);
    expect(wrapper.emitted("copy-markdown-text")).toHaveLength(1);
  });

  it("does not show copy actions outside a successful markdown preview", () => {
    const wrapper = mountPreview({ name: "file.txt" });

    expect(wrapper.findAllComponents({ name: "ElButton" })).toHaveLength(0);
  });
});
