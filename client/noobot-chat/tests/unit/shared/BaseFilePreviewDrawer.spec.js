/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import BaseFilePreviewDrawer from "../../../src/shared/ui/BaseFilePreviewDrawer.vue";
import MonotonicEditCard from "../../../src/modules/chat/components/message/actions/MonotonicEditCard.vue";
import { createElementPlusMountOptions } from "../fixtures/elementPlusStubs.js";
import { OVERLAY_DEPTH_STATE_KEY } from "../../../src/shared/composables/useOverlayHistory.js";

function waitForPopState() {
  return new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
}

function mockViewport(matches) {
  let change;
  const mediaQuery = {
    matches,
    addEventListener: vi.fn((event, listener) => {
      change = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQuery),
  );
  return (matches) => change({ matches });
}

function mountDrawer() {
  const visible = ref(false);
  const Host = defineComponent({
    setup() {
      return () =>
        h(
          BaseFilePreviewDrawer,
          {
            title: "file.txt",
            modelValue: visible.value,
            "onUpdate:modelValue": (value) => {
              visible.value = value;
            },
          },
          () => h("pre", "file content"),
        );
    },
  });
  return { visible, wrapper: mount(Host, { global: { stubs: { "el-drawer": true } } }) };
}

afterEach(() => vi.unstubAllGlobals());

describe("BaseFilePreviewDrawer", () => {
  it("uses full width on mobile and updates to the shared desktop size", async () => {
    const resize = mockViewport(true);
    const { wrapper } = mountDrawer();
    await nextTick();
    expect(wrapper.get("el-drawer-stub").attributes("size")).toBe("100%");
    resize(false);
    await nextTick();
    expect(wrapper.get("el-drawer-stub").attributes("size")).toBe("72%");
    expect(wrapper.get("el-drawer-stub").attributes("direction")).toBe("rtl");
    wrapper.unmount();
  });

  it("opens one pseudo route, closes on Back, and restores the parent route", async () => {
    mockViewport(false);
    history.replaceState({}, "", "/?session=preview-test&panel=workspace");
    const { wrapper, visible } = mountDrawer();
    visible.value = true;
    await nextTick();
    expect(history.state[OVERLAY_DEPTH_STATE_KEY]).toBe(1);
    expect(location.search).toBe("?session=preview-test&panel=workspace&overlay=file-preview");
    const popped = waitForPopState();
    history.back();
    await popped;
    expect(visible.value).toBe(false);
    expect(location.search).toBe("?session=preview-test&panel=workspace");
    wrapper.unmount();
    history.replaceState({}, "", "/");
  });

  it("rewinds the pseudo route when the close button updates the model", async () => {
    mockViewport(false);
    const { wrapper, visible } = mountDrawer();
    visible.value = true;
    await nextTick();
    const popped = waitForPopState();
    wrapper.findComponent({ name: "ElDrawer" }).vm.$emit("update:modelValue", false);
    await popped;
    expect(visible.value).toBe(false);
    expect(new URLSearchParams(location.search).has("overlay")).toBe(false);
    wrapper.unmount();
  });

  it("routes edit attachment images through the same preview drawer", async () => {
    mockViewport(true);
    const wrapper = mount(MonotonicEditCard, {
      props: { editAttachments: [{ name: "image.png", previewUrl: "blob:preview-image" }] },
      global: {
        ...createElementPlusMountOptions({ "el-drawer": true }),
        renderStubDefaultSlot: true,
      },
    });
    await wrapper.get("button.monotonic-attachment-preview").trigger("click");
    expect(wrapper.get(".preview-image").attributes("src")).toBe("blob:preview-image");
    expect(new URLSearchParams(location.search).get("overlay")).toBe("file-preview");
    const popped = waitForPopState();
    history.back();
    await popped;
    expect(wrapper.find(".preview-image").exists()).toBe(false);
    wrapper.unmount();
  });
});
