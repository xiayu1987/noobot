import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import WorkflowSessionMessageItem from "../../../../../plugin/noobot-plugin-workflow/frontend/components/WorkflowSessionMessageItem.vue";

vi.mock("/project/client/noobot-chat/src/shared/message/SharedChatMessageItem.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "SharedChatMessageItem",
      emits: ["open-thinking-details"],
      setup(_, { emit }) {
        const payload = {
          messageItem: requiredProps.messageItem,
          allMessages: requiredProps.allMessages,
        };
        return () => h("button", {
          class: "open-thinking-details",
          onClick: () => emit("open-thinking-details", payload),
        }, "open");
      },
    }),
  };
});

const requiredProps = {
  messageItem: { role: "assistant", pending: false, completedToolLogs: [] },
  allMessages: [],
  sessionDocs: [],
  userId: "user-1",
  authFetch: null,
  renderMarkdown: (value = "") => value,
  formatTime: (value = "") => value,
  formatFileSize: (value = 0) => `${value} B`,
  isImageMime: () => false,
};

describe("workflow thinking details forwarding", () => {
  it("forwards open-thinking-details from workflow session message item", async () => {
    const payload = {
      messageItem: requiredProps.messageItem,
      allMessages: requiredProps.allMessages,
    };

    const wrapper = mount(WorkflowSessionMessageItem, {
      props: requiredProps,
    });

    await wrapper.find(".open-thinking-details").trigger("click");

    expect(wrapper.emitted("open-thinking-details")?.[0]?.[0]).toStrictEqual(payload);
  });
});
