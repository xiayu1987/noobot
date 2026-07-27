/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MessageStatusRow from "../../../src/shared/message/components/MessageStatusRow.vue";

const global = {
  stubs: {
    "el-steps": { template: "<div class='steps'><slot /></div>" },
    "el-step": { props: ["title"], template: "<span class='step'>{{ title }}</span>" },
  },
};

describe("MessageStatusRow", () => {
  it("does not render without a lifecycle state", () => {
    const wrapper = mount(MessageStatusRow, { global });
    expect(wrapper.find(".message-status-steps").exists()).toBe(false);
  });

  it("renders the common running lifecycle", () => {
    const wrapper = mount(MessageStatusRow, {
      props: { statusStepState: "sending" },
      global,
    });
    expect(wrapper.find(".message-status-steps").classes()).toContain("is-running");
    expect(wrapper.findAll(".step")).toHaveLength(4);
  });

  it("renders terminal error presentation", () => {
    const wrapper = mount(MessageStatusRow, {
      props: { statusStepState: "error" },
      global,
    });
    expect(wrapper.find(".message-status-steps").classes()).toContain("is-error");
    expect(wrapper.find(".message-status-steps").classes()).not.toContain("is-running");
  });
});
