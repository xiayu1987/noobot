/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MonotonicMessageActions from "../../../../src/modules/chat/components/message/actions/MonotonicMessageActions.vue";
import { createElementPlusMountOptions } from "../../fixtures/elementPlusStubs.js";
import { translateMessageKey } from "../../../../src/shared/i18n/messageCatalog.js";

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn() },
  ElMessageBox: {
    confirm: vi.fn(async () => true),
  },
}));

import { ElMessageBox } from "element-plus";

function mountActions(overrides = {}) {
  return mount(MonotonicMessageActions, {
    props: {
      visible: true,
      disabled: false,
      messageItem: { id: "m1", content: "old content" },
      translate: (key, params) => translateMessageKey("zh-CN", key, params),
      onDelete: vi.fn(async () => true),
      onResend: vi.fn(async () => true),
      ...overrides,
    },
    global: createElementPlusMountOptions({ "el-drawer": true }),
  });
}

describe("MonotonicMessageActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders only when visible", () => {
    const wrapper = mountActions({ visible: true });
    for (const [selector, key] of [
      [".is-primary", "message.monotonicEdit"],
      [".danger-text", "message.monotonicDelete"],
    ]) {
      const button = wrapper.find(`button${selector}`);
      const label = translateMessageKey("zh-CN", key);
      expect(button.attributes("aria-label")).toBe(label);
      expect(button.attributes("title")).toBe(label);
      expect(button.text()).toBe("");
      expect(button.find("svg").attributes("aria-hidden")).toBe("true");
    }
    expect(mountActions({ visible: false }).find(".monotonic-message-actions").exists()).toBe(
      false,
    );
  });

  it("disables actions when sending or operating", async () => {
    ElMessageBox.confirm.mockImplementationOnce(() => new Promise(() => {}));
    const wrapper = mountActions();

    await wrapper.find("button.danger-text").trigger("click");
    await nextTick();
    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(wrapper.find("button.is-primary").attributes("disabled")).toBeDefined();
    expect(wrapper.find("button.danger-text").attributes("disabled")).toBeDefined();
    const disabledWrapper = mountActions({ disabled: true });
    expect(disabledWrapper.find("button.is-primary").attributes("disabled")).toBeDefined();
    expect(disabledWrapper.find("button.danger-text").attributes("disabled")).toBeDefined();
  });

  it("calls delete handler with message payload", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onDelete = vi.fn(async () => true);
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onDelete, onResend });

    await wrapper.find("button.danger-text").trigger("click");

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(messageItem);
    expect(onResend).not.toHaveBeenCalled();
  });

  it("turns the original user message into inline edit mode and sends edited content", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onResend });

    await wrapper.find("button.is-primary").trigger("click");
    await nextTick();
    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(messageItem.__monotonicEditing).toBe(true);
    expect(wrapper.find(".monotonic-edit-textarea").exists()).toBe(true);
    expect(wrapper.vm.$.setupState.draftContent).toBe("old content");

    wrapper.vm.$.setupState.draftContent = "edited content";
    await wrapper.findAll(".monotonic-footer-btn").at(1).trigger("click");

    expect(onResend).toHaveBeenCalledWith(messageItem, "edited content", {
      attachments: [],
      attachmentFiles: [],
      removedAttachmentKeys: [],
    });
    expect(messageItem.__monotonicEditing).toBe(false);
  });

  it("forwards attachment count parameters to the locale translator", async () => {
    const wrapper = mountActions();

    await wrapper.find("button.is-primary").trigger("click");
    await nextTick();

    const stats = wrapper.find(".monotonic-attachment-stats");
    expect(stats.text()).toContain("0 个");
    expect(stats.text()).not.toContain("{count}");
  });
});
