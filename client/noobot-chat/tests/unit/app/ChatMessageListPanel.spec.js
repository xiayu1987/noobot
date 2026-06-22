import { defineComponent, nextTick, onMounted, onUnmounted, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ChatMessageListPanel from "../../../src/app/ChatMessageListPanel.vue";
import { RoleEnum } from "../../../src/shared/constants/chatConstants";

const chatMessageItemMock = vi.hoisted(() => ({
  field: "content",
  mounted: null,
  unmounted: null,
}));

vi.mock("../../../src/modules/message/ChatMessageItem.vue", async () => {
  const { defineComponent: defineVueComponent, h, onMounted: onVueMounted, onUnmounted: onVueUnmounted } = await import("vue");
  return {
    default: defineVueComponent({
      name: "ChatMessageItem",
      props: {
        messageItem: { type: Object, required: true },
      },
      setup(props) {
        onVueMounted(() => chatMessageItemMock.mounted?.());
        onVueUnmounted(() => chatMessageItemMock.unmounted?.());
        return () => {
          const messageItem = props.messageItem || {};
          return h("div", { class: "chat-message-item-stub" }, String(messageItem?.[chatMessageItemMock.field] || ""));
        };
      },
    }),
  };
});

vi.mock("../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

function mountPanel(props = {}) {
  chatMessageItemMock.field = "content";
  chatMessageItemMock.mounted = null;
  chatMessageItemMock.unmounted = null;
  const ChatMessageItemStub = defineComponent({
    name: "ChatMessageItem",
    props: {
      messageItem: { type: Object, required: true },
    },
    template: "<div class='chat-message-item-stub'>{{ messageItem.content }}</div>",
  });
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
        ChatMessageItem: ChatMessageItemStub,
        "chat-message-item": ChatMessageItemStub,
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
    chatMessageItemMock.field = "content";
    chatMessageItemMock.mounted = () => {
      counters.mounted += 1;
    };
    chatMessageItemMock.unmounted = () => {
      counters.unmounted += 1;
    };

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

    await wrapper.setProps({
      activeSession: {
        messages: [{ role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "v2", ts: 2 }],
      },
    });
    await nextTick();

    expect(counters.mounted).toBe(1);
    expect(counters.unmounted).toBe(0);
  });


  it("keeps assistant item mounted when dialogProcessId arrives for the same placeholder", async () => {
    const counters = reactive({ mounted: 0, unmounted: 0 });
    chatMessageItemMock.field = "dialogProcessId";
    chatMessageItemMock.mounted = () => {
      counters.mounted += 1;
    };
    chatMessageItemMock.unmounted = () => {
      counters.unmounted += 1;
    };

    const activeSession = reactive({
      messages: [
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "",
          content: "",
        },
      ],
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
          "el-scrollbar": defineComponent({
            name: "ElScrollbarStub",
            template: "<div><slot /></div>",
          }),
          "el-skeleton": true,
        },
      },
    });

    expect(counters.mounted).toBe(1);

    await wrapper.setProps({
      activeSession: {
        messages: [
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "dp-live",
            content: "streaming",
          },
        ],
      },
    });
    await nextTick();

    expect(counters.mounted).toBe(1);
    expect(counters.unmounted).toBe(0);
    expect(wrapper.find(".chat-message-item-stub").text()).toBe("dp-live");
  });

  it("hydrates latest assistant running time from conversationStateSnapshot during render", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const activeSession = {
      id: "s-1",
      backendSessionId: "s-1",
      messages: [
        { role: RoleEnum.USER, content: "edited orphan" },
        { role: RoleEnum.ASSISTANT, content: "partial after refresh", pending: false },
      ],
    };

    mountPanel({
      activeSession,
      conversationStateSnapshot: {
        "s-1::__session__": {
          sessionId: "s-1",
          dialogProcessId: "",
          state: "sending",
          createdAt: startedAt,
          createdAtMs: Date.parse(startedAt),
          updatedAt: startedAt,
          updatedAtMs: Date.parse(startedAt),
        },
      },
    });

    const assistant = activeSession.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending", createdAt: startedAt });
    expect(assistant.thinkingStartedAt).toBe(startedAt);
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
    expect(
      wrapper.vm.getMessageAnchorId(
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "dp-assistant",
        },
        1,
      ),
    ).toBe("chat-message-assistant-dp-assistant-1");
    expect(typeof wrapper.vm.scrollToMessageAnchor).toBe("function");
  });
});
