import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import MonotonicMessageActions from "../../../../../../plugin/noobot-plugin-harness/frontend/components/MonotonicMessageActions.vue";

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
    const pendingDelete = vi.fn(() => new Promise(() => {}));
    const wrapper = mountActions({ onDelete: pendingDelete });

    await wrapper.findAll("button")[1].trigger("click");
    await nextTick();

    expect(wrapper.findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(mountActions({ disabled: true }).findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
  });

  it("calls delete handler with message payload", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onDelete = vi.fn(async () => true);
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onDelete, onResend });

    await wrapper.findAll("button")[1].trigger("click");

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(messageItem);
    expect(onResend).not.toHaveBeenCalled();
  });

  it("turns the original user message into inline edit mode and sends edited content", async () => {
    const messageItem = { id: "m1", content: "old content" };
    const onResend = vi.fn(async () => true);
    const wrapper = mountActions({ messageItem, onResend });

    await wrapper.findAll("button")[0].trigger("click");
    await nextTick();

    expect(messageItem.__monotonicEditing).toBe(true);
    const textarea = wrapper.find("textarea");
    expect(textarea.exists()).toBe(true);
    expect(textarea.element.value).toBe("old content");

    await textarea.setValue("edited content");
    await wrapper.findAll("button").at(-1).trigger("click");

    expect(onResend).toHaveBeenCalledWith(messageItem, "edited content");
    expect(messageItem.__monotonicEditing).toBe(false);
  });
});
