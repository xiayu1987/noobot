import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MonotonicMessageActions from "../../../../src/shared/message/MonotonicMessageActions.vue";

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
      translate: (_key, fallback) => fallback,
      onDelete: vi.fn(async () => true),
      onResend: vi.fn(async () => true),
      ...overrides,
    },
  });
}

describe("MonotonicMessageActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only when visible", () => {
    expect(mountActions({ visible: true }).text()).toContain("编辑");
    expect(mountActions({ visible: false }).find(".monotonic-message-actions").exists()).toBe(false);
  });

  it("disables actions when sending or operating", async () => {
    ElMessageBox.confirm.mockImplementationOnce(() => new Promise(() => {}));
    const wrapper = mountActions();

    await wrapper.find(".monotonic-chip-btn.is-danger").trigger("click");
    await nextTick();
    wrapper.vm.$forceUpdate();
    await nextTick();

    expect(wrapper.find(".monotonic-chip-btn.is-primary").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".monotonic-chip-btn.is-danger").attributes("disabled")).toBeDefined();
    const disabledWrapper = mountActions({ disabled: true });
    expect(disabledWrapper.find(".monotonic-chip-btn.is-primary").attributes("disabled")).toBeDefined();
    expect(disabledWrapper.find(".monotonic-chip-btn.is-danger").attributes("disabled")).toBeDefined();
  });

  it("calls delete handler with message payload", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onDelete = vi.fn(async () => true);
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onDelete, onResend });

    await wrapper.find(".monotonic-chip-btn.is-danger").trigger("click");

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(messageItem);
    expect(onResend).not.toHaveBeenCalled();
  });

  it("turns the original user message into inline edit mode and sends edited content", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onResend });

    await wrapper.find(".monotonic-chip-btn.is-primary").trigger("click");
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
});
