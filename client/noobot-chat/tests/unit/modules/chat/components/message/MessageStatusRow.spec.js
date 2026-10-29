/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import MessageStatusRow from "../../../../../../src/modules/chat/components/message/MessageStatusRow.vue";

function stepStatuses(wrapper) {
  return wrapper
    .findAll(".message-status-steps__item")
    .map((item) => item.classes().find((name) => name.startsWith("is-")));
}

describe("MessageStatusRow", () => {
  it("does not render without a lifecycle state", () => {
    const wrapper = mount(MessageStatusRow);
    expect(wrapper.find(".message-status-steps").exists()).toBe(false);
  });

  it("renders the common running lifecycle", () => {
    const wrapper = mount(MessageStatusRow, { props: { statusStepState: "sending" } });
    expect(wrapper.find(".message-status-steps").classes()).toContain("is-running");
    expect(stepStatuses(wrapper)).toEqual(["is-success", "is-process", "is-wait", "is-wait"]);
    expect(wrapper.findAll("[aria-current='step']")).toHaveLength(1);
  });

  it("renders terminal error presentation", () => {
    const wrapper = mount(MessageStatusRow, { props: { statusStepState: "error" } });
    expect(wrapper.find(".message-status-steps").classes()).toContain("is-error");
    expect(wrapper.find(".message-status-steps").classes()).not.toContain("is-running");
    expect(stepStatuses(wrapper)).toEqual(["is-error", "is-error", "is-error", "is-error"]);
  });

  it("unmounts in the same flush it was mounted in", async () => {
    const visible = ref(false);
    const errors = [];
    const HideOnSetup = defineComponent({
      setup() {
        visible.value = false;
        return () => null;
      },
    });
    const app = createApp({
      render: () =>
        visible.value
          ? [h(MessageStatusRow, { statusStepState: "sending" }), h(HideOnSetup)]
          : null,
    });
    app.config.errorHandler = (error) => errors.push(error);
    app.mount(document.createElement("div"));
    visible.value = true;
    await nextTick();
    await nextTick();
    app.unmount();
    expect(errors).toEqual([]);
  });
});
