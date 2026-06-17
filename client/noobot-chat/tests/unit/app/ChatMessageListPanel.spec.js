import { defineComponent, onMounted, onUnmounted, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ChatMessageListPanel from "../../../src/app/ChatMessageListPanel.vue";
import { RoleEnum } from "../../../src/shared/constants/chatConstants";

vi.mock("../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

function mountPanel(props = {}) {
  return mount(ChatMessageListPanel, {
    props: {
      loadingSessionDetail: false,
      activeSession: { messages: [] },
      shouldRenderMessageInChat: () => true,
      userId: "u-1",
      authFetch: null,
      renderMarkdown: (v) => v,
      formatTime: (v) => String(v || ""),
      formatFileSize: (v) => String(v || ""),
      isImageMime: () => false,
      emptyLogoSrc: "",
      ...props,
    },
    global: {
      stubs: {
        "el-scrollbar": defineComponent({
          name: "ElScrollbarStub",
          template: "<div class='el-scrollbar-stub'><slot /></div>",
          methods: {
            setScrollTop() {},
          },
        }),
        "el-skeleton": defineComponent({
          name: "ElSkeletonStub",
          template: "<div class='el-skeleton-stub'></div>",
        }),
      },
    },
  });
}

describe("ChatMessageListPanel", () => {
  it("does not show skeleton when loading detail but messages already exist", () => {
    const wrapper = mountPanel({
      loadingSessionDetail: true,
      activeSession: {
        messages: [{ role: RoleEnum.USER, content: "hello" }],
      },
    });
    expect(wrapper.find(".el-skeleton-stub").exists()).toBe(false);
  });

  it("message item key remains stable when only content changes", async () => {
    const counters = reactive({ mounted: 0, unmounted: 0 });
    const ChatMessageItemStub = defineComponent({
      name: "ChatMessageItem",
      props: {
        messageItem: { type: Object, required: true },
      },
      setup() {
        onMounted(() => {
          counters.mounted += 1;
        });
        onUnmounted(() => {
          counters.unmounted += 1;
        });
        return {};
      },
      template: "<div class='chat-message-item-stub'>{{ messageItem.content }}</div>",
    });

    const activeSession = reactive({
      messages: [{ role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "v1", ts: 1 }],
    });
    const wrapper = mount(ChatMessageListPanel, {
      props: {
        loadingSessionDetail: false,
        activeSession,
        shouldRenderMessageInChat: () => true,
        userId: "u-1",
        authFetch: null,
        renderMarkdown: (v) => v,
        formatTime: (v) => String(v || ""),
        formatFileSize: (v) => String(v || ""),
        isImageMime: () => false,
        emptyLogoSrc: "",
      },
      global: {
        stubs: {
          ChatMessageItem: ChatMessageItemStub,
          "el-scrollbar": defineComponent({
            name: "ElScrollbarStub",
            template: "<div><slot /></div>",
          }),
          "el-skeleton": true,
        },
      },
    });

    expect(counters.mounted).toBe(1);
    expect(counters.unmounted).toBe(0);

    activeSession.messages = [
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "v2", ts: 2 },
    ];
    await wrapper.vm.$nextTick();

    expect(counters.mounted).toBe(1);
    expect(counters.unmounted).toBe(0);
  });

  it("renders stable anchors and exposes scrollToMessageAnchor", () => {
    const wrapper = mountPanel({
      activeSession: {
        messages: [
          { role: RoleEnum.USER, dialogProcessId: "dp-user", content: "hello" },
          { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-assistant", content: "hi" },
        ],
      },
    });

    const anchors = wrapper.findAll("[data-chat-message-anchor]");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].attributes("id")).toBe("chat-message-user-dp-user-0");
    expect(anchors[0].attributes("data-chat-message-anchor")).toBe("chat-message-user-dp-user-0");
    expect(wrapper.vm.getMessageAnchorId({ role: RoleEnum.ASSISTANT, dialogProcessId: "dp-assistant" }, 1)).toBe(
      "chat-message-assistant-dp-assistant-1",
    );
    expect(typeof wrapper.vm.scrollToMessageAnchor).toBe("function");
  });
});
