import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WorkflowSessionMessageItem from "../../../../../plugin/noobot-plugin-workflow/frontend/components/WorkflowSessionMessageItem.vue";

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
      global: {
        stubs: {
          SharedChatMessageItem: {
            emits: ["open-thinking-details"],
            template: '<button class="open-thinking-details" @click="$emit(\'open-thinking-details\', payload)">open</button>',
            data() {
              return { payload };
            },
          },
        },
      },
    });

    await wrapper.find(".open-thinking-details").trigger("click");

    expect(wrapper.emitted("open-thinking-details")?.[0]?.[0]).toStrictEqual(payload);
  });
});
