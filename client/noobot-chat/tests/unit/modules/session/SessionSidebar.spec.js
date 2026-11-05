/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import SessionSidebar from "../../../../src/modules/session/components/SessionSidebar.vue";
import { CircleCheckFilled, CircleCloseFilled, Setting } from "@element-plus/icons-vue";

const slotStub = defineComponent({
  setup(_, { slots }) {
    return () => h("div", slots.default?.());
  },
});
const wrappers = [];
function mountSidebar(props = {}) {
  const wrapper = mount(SessionSidebar, {
    props: {
      sidebarCollapsed: false,
      isMobile: false,
      mobileSidebarOpen: false,
      userId: "test-user",
      connectCode: "",
      connecting: false,
      connected: false,
      sending: false,
      loadingSessions: false,
      sessions: [],
      activeSessionId: "",
      turnRuntimeRegistry: {},
      ...props,
    },
    global: {
      stubs: {
        SessionListPanel: true,
        ElIcon: slotStub,
        ElInput: true,
        ElButton: defineComponent({
          emits: ["click"],
          setup(_, { slots, emit }) {
            return () => h("button", { onClick: () => emit("click") }, slots.default?.());
          },
        }),
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe("SessionSidebar connection settings", () => {
  it("initially opens the disconnected form in the footer instead of the header", () => {
    const wrapper = mountSidebar();
    expect(wrapper.find(".sidebar-header").findAllComponents({ name: "ElInput" })).toHaveLength(0);
    expect(wrapper.find(".connection-panel").findAllComponents({ name: "ElInput" })).toHaveLength(
      2,
    );
    expect(wrapper.find(".sidebar-footer .connection-panel").exists()).toBe(true);
    expect(wrapper.find(".connection-status").attributes("role")).toBe("status");
    expect(wrapper.find(".sidebar-settings-btn").attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".connection-status").findComponent(CircleCloseFilled).exists()).toBe(true);
    expect(wrapper.find(".sidebar-settings-btn").findComponent(Setting).exists()).toBe(true);
  });

  it("closes after connection succeeds and reopens after connection loss", async () => {
    const wrapper = mountSidebar();
    await wrapper.setProps({ connecting: true });
    expect(wrapper.find(".connection-panel").exists()).toBe(true);
    await wrapper.setProps({ connecting: false, connected: true });
    expect(wrapper.find(".connection-panel").exists()).toBe(false);
    expect(wrapper.find(".sidebar-settings-btn").attributes("data-connected")).toBe("true");
    expect(wrapper.find(".sidebar-settings-btn").findComponent(CircleCheckFilled).exists()).toBe(
      true,
    );
    await wrapper.setProps({ connected: false });
    expect(wrapper.find(".connection-panel").exists()).toBe(true);
  });

  it.each([
    { sidebarCollapsed: false },
    { sidebarCollapsed: true },
    { isMobile: true, mobileSidebarOpen: true },
  ])("opens settings manually when connected and closes with Escape: %j", async (props) => {
    const wrapper = mountSidebar({ connected: true, ...props });
    expect(wrapper.find(".connection-panel").exists()).toBe(false);
    await wrapper.find(".sidebar-settings-btn").trigger("click");
    expect(wrapper.find(".connection-panel").exists()).toBe(true);
    expect(wrapper.find(".connection-status").classes()).toContain("connected");
    await wrapper.find(".connection-panel").trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".connection-panel").exists()).toBe(false);
    expect(wrapper.find(".sidebar-settings-btn").attributes("aria-expanded")).toBe("false");
  });

  it("preserves field update and connect events after moving the form", async () => {
    const wrapper = mountSidebar();
    const inputs = wrapper.findAllComponents({ name: "ElInput" });
    inputs[0].vm.$emit("update:model-value", "updated-user");
    inputs[1].vm.$emit("update:model-value", "updated-code");
    await wrapper.find(".connect-btn").trigger("click");
    expect(wrapper.emitted("update:user-id")).toEqual([["updated-user"]]);
    expect(wrapper.emitted("update:connect-code")).toEqual([["updated-code"]]);
    expect(wrapper.emitted("connect")).toEqual([[]]);
  });

  it("allows closing a disconnected panel and reopens on the next disconnect", async () => {
    const wrapper = mountSidebar();
    await wrapper.find(".connection-panel-heading button").trigger("click");
    expect(wrapper.find(".connection-panel").exists()).toBe(false);
    await wrapper.setProps({ connected: true });
    await wrapper.setProps({ connected: false });
    expect(wrapper.find(".connection-panel").exists()).toBe(true);
  });
});
