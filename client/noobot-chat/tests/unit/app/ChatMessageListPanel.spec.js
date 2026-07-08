import { defineComponent, nextTick, onMounted, onUnmounted, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ChatMessageListPanel from "../../../src/app/ChatMessageListPanel.vue";
import { RoleEnum } from "../../../src/shared/constants/chatConstants";

const chatMessageItemMock = vi.hoisted(() => ({
  field: "content",
  mounted: null,
  unmounted: null,
  render: null,
}));

vi.mock("../../../src/modules/message/ChatMessageItem.vue", async () => {
  const { defineComponent: defineVueComponent, h, onMounted: onVueMounted, onUnmounted: onVueUnmounted } = await import("vue");
  return {
    default: defineVueComponent({
      name: "ChatMessageItem",
      props: {
        messageItem: { type: Object, required: true },
        allMessages: { type: Array, default: () => [] },
      },
      setup(props) {
        onVueMounted(() => chatMessageItemMock.mounted?.());
        onVueUnmounted(() => chatMessageItemMock.unmounted?.());
        return () => {
          const messageItem = props.messageItem || {};
          chatMessageItemMock.render?.(props);
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

function mountPanel(props = {}, options = {}) {
  if (!options.preserveChatMessageItemMock) {
    chatMessageItemMock.field = "content";
    chatMessageItemMock.mounted = null;
    chatMessageItemMock.unmounted = null;
    chatMessageItemMock.render = null;
  }
  const ChatMessageItemStub = defineComponent({
    name: "ChatMessageItem",
    props: {
      messageItem: { type: Object, required: true },
      allMessages: { type: Array, default: () => [] },
    },
    setup(itemProps) {
      return () => {
        chatMessageItemMock.render?.(itemProps);
        return itemProps.messageItem?.content || "";
      };
    },
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

  it("remounts assistant item when resend replaces it with a new turnScopeId", async () => {
    const counters = reactive({ mounted: 0, unmounted: 0 });
    chatMessageItemMock.field = "statusLabel";
    chatMessageItemMock.mounted = () => {
      counters.mounted += 1;
    };
    chatMessageItemMock.unmounted = () => {
      counters.unmounted += 1;
    };

    const activeSession = reactive({
      messages: [
        { role: RoleEnum.USER, content: "old", turnScopeId: "client-turn:old" },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: "client-turn:old",
          pending: false,
          statusLabel: "chat.stopped",
          channelState: { state: "stopped", turnScopeId: "client-turn:old" },
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

    expect(counters.mounted).toBe(2);
    expect(counters.unmounted).toBe(0);
    expect(wrapper.findAll(".chat-message-item-stub")[1].text()).toBe("chat.stopped");

    await wrapper.setProps({
      activeSession: {
        messages: [
          { role: RoleEnum.USER, content: "new", turnScopeId: "client-turn:new" },
          {
            role: RoleEnum.ASSISTANT,
            content: "",
            turnScopeId: "client-turn:new",
            pending: true,
            statusLabel: "",
            channelState: { state: "sending", turnScopeId: "client-turn:new" },
          },
        ],
      },
    });
    await nextTick();

    expect(counters.mounted).toBe(4);
    expect(counters.unmounted).toBe(2);
    expect(wrapper.findAll(".chat-message-item-stub")[1].text()).toBe("");
  });

  it("hydrates latest assistant running time from runStateSnapshot during render", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const activeSession = {
      id: "s-1",
      backendSessionId: "s-1",
      messages: [
        { role: RoleEnum.USER, content: "edited orphan", turnScopeId: "turn-live" },
        { role: RoleEnum.ASSISTANT, content: "partial after refresh", pending: false, turnScopeId: "turn-live" },
      ],
    };

    mountPanel({
      activeSession,
      runStateSnapshot: {
        sessionId: "s-1",
        dialogProcessId: "",
        turnScopeId: "turn-live",
        state: "sending",
        createdAtIso: startedAt,
        createdAtMs: Date.parse(startedAt),
        updatedAtIso: startedAt,
        updatedAtMs: Date.parse(startedAt),
      },
    });

    const assistant = activeSession.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending" });
    expect(assistant.channelState?.createdAt).toBeUndefined();
    expect(assistant.channelState?.createdAtMs).toBeUndefined();
    expect(assistant.thinkingStartedAt).toBe(startedAt);
  });

  it("clears runtime-applied pending state when runStateSnapshot becomes terminal", async () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const activeSession = reactive({
      id: "s-1",
      backendSessionId: "s-1",
      messages: [
        { role: RoleEnum.USER, content: "q", turnScopeId: "turn-live" },
        { role: RoleEnum.ASSISTANT, content: "partial", pending: false, turnScopeId: "turn-live" },
      ],
    });
    const runStateSnapshot = reactive({
      sessionId: "s-1",
      dialogProcessId: "",
      turnScopeId: "turn-live",
      state: "sending",
      createdAtIso: startedAt,
      createdAtMs: Date.parse(startedAt),
      updatedAtIso: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const wrapper = mountPanel({
      activeSession,
      runStateSnapshot,
    });

    const assistant = activeSession.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending" });

    wrapper.unmount();
    mountPanel({
      activeSession,
      runStateSnapshot: {
        ...runStateSnapshot,
        state: "frontend_completed",
        updatedAtIso: "2026-06-22T10:00:05.000Z",
        updatedAtMs: Date.parse("2026-06-22T10:00:05.000Z"),
      },
    });
    await nextTick();

    expect(assistant.pending).toBe(false);
    expect(assistant.channelState).toMatchObject({ state: "frontend_completed" });
    expect(assistant.thinkingFinishedAt).toBeTruthy();
  });

  it("clears obsolete previous pending assistants while keeping the latest run pending", () => {
    const activeSession = {
      id: "s-1",
      backendSessionId: "s-1",
      messages: [
        { role: RoleEnum.USER, content: "old q", turnScopeId: "turn-old" },
        {
          role: RoleEnum.ASSISTANT,
          content: "old answer",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-old",
        },
        { role: RoleEnum.USER, content: "new q", turnScopeId: "turn-new" },
        { role: RoleEnum.ASSISTANT, content: "new partial", pending: false, turnScopeId: "turn-new" },
      ],
    };

    mountPanel({
      activeSession,
      runStateSnapshot: {
        sessionId: "s-1",
        dialogProcessId: "",
        turnScopeId: "turn-new",
        state: "sending",
      },
    });

    expect(activeSession.messages[1].pending).toBe(false);
    expect(activeSession.messages[1].channelState).toMatchObject({ state: "frontend_completed" });
    expect(activeSession.messages[3].pending).toBe(true);
  });

  it("passes rendered messages before stale rawMessages to message actions in old sessions", () => {
    const capturedProps = [];
    chatMessageItemMock.render = (itemProps = {}) => {
      capturedProps.push({
        messageItem: itemProps.messageItem,
        allMessages: itemProps.allMessages,
      });
    };
    const staleRawMessages = [
      { role: RoleEnum.USER, content: "history", turnScopeId: "turn-history" },
      { role: RoleEnum.ASSISTANT, content: "history answer", turnScopeId: "turn-history" },
    ];
    const renderedMessages = [
      ...staleRawMessages,
      { role: RoleEnum.USER, content: "全仓回归测试", turnScopeId: "turn-new" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: false,
        turnScopeId: "turn-new",
        channelState: { state: "stopped", turnScopeId: "turn-new" },
      },
    ];

    mountPanel({
      activeSession: {
        messages: renderedMessages,
        rawMessages: staleRawMessages,
      },
    }, { preserveChatMessageItemMock: true });

    expect(capturedProps).toHaveLength(renderedMessages.length);
    expect(capturedProps[2].messageItem.content).toBe("全仓回归测试");
    expect(capturedProps[2].allMessages).toHaveLength(renderedMessages.length);
    expect(capturedProps[2].allMessages.map((item) => item.content)).toEqual(
      renderedMessages.map((item) => item.content),
    );
    expect(capturedProps[2].allMessages).not.toBe(staleRawMessages);
  });

  it("renders stable anchors and exposes scrollToMessageAnchor", () => {
    const wrapper = mountPanel({
      activeSession: {
        messages: [
          { role: RoleEnum.USER, sessionId: "session-1", turnScopeId: "turn-user", content: "hello" },
          { role: RoleEnum.ASSISTANT, sessionId: "session-1", turnScopeId: "turn-assistant", content: "hi" },
        ],
      },
    });

    const anchors = wrapper.findAll("[data-chat-message-anchor]");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].attributes("id")).toBe("chat-message-user-session-1--turn-user-0");
    expect(anchors[0].attributes("data-chat-message-anchor")).toBe("chat-message-user-session-1--turn-user-0");
    expect(wrapper.vm.getMessageAnchorId({
      role: RoleEnum.ASSISTANT,
      sessionId: "session-1",
      turnScopeId: "turn-assistant",
    }, 1)).toBe(
      "chat-message-assistant-session-1--turn-assistant-1",
    );
    expect(
      wrapper.vm.getMessageAnchorId(
        {
          role: RoleEnum.ASSISTANT,
          sessionId: "session-1",
          turnScopeId: "turn-assistant",
        },
        1,
      ),
    ).toBe("chat-message-assistant-session-1--turn-assistant-1");
    expect(typeof wrapper.vm.scrollToMessageAnchor).toBe("function");
  });
});
