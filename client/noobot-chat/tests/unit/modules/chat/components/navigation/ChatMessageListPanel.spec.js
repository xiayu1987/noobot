/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatMessageListPanel from "../../../../../../src/modules/chat/components/navigation/ChatMessageListPanel.vue";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { RoleEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

const chatMessageItemMock = vi.hoisted(() => ({
  field: "content",
  mounted: null,
  unmounted: null,
  render: null,
}));

vi.mock("../../../../../../src/modules/chat/components/message/ChatMessageItem.vue", async () => {
  const {
    defineComponent: defineVueComponent,
    h,
    onMounted: onVueMounted,
    onUnmounted: onVueUnmounted,
  } = await import("vue");
  return {
    default: defineVueComponent({
      name: "ChatMessageItem",
      props: {
        messageItem: { type: Object, required: true },
        allMessages: { type: Array, default: () => [] },
        currentTurn: { type: Boolean, default: false },
        sessionDocs: { type: Array, default: () => [] },
        userId: { type: String, default: "" },
        renderMarkdown: { type: Function, default: null },
        formatTime: { type: Function, default: null },
        formatFileSize: { type: Function, default: null },
        isImageMime: { type: Function, default: null },
        sending: { type: Boolean, default: false },
        deleteMonotonicMessage: { type: Function, default: null },
        resendMonotonicMessage: { type: Function, default: null },
        stopExecution: { type: Function, default: null },
      },
      emits: ["openThinkingDetails"],
      setup(props) {
        onVueMounted(() => chatMessageItemMock.mounted?.());
        onVueUnmounted(() => chatMessageItemMock.unmounted?.());
        return () => {
          const messageItem = props.messageItem || {};
          chatMessageItemMock.render?.(props);
          return h(
            "div",
            { class: "chat-message-item-stub" },
            String(messageItem?.[chatMessageItemMock.field] || ""),
          );
        };
      },
    }),
  };
});

vi.mock("../../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

const VIEWPORT_HEIGHT_PX = 2000;

const ScrollbarStub = defineComponent({
  name: "ElScrollbarStub",
  template: "<div class='el-scrollbar-stub'><slot /></div>",
  computed: {
    wrapRef() {
      return this.$el;
    },
  },
  mounted() {
    Object.defineProperty(this.$el, "offsetHeight", { value: VIEWPORT_HEIGHT_PX });
    Object.defineProperty(this.$el, "offsetWidth", { value: VIEWPORT_HEIGHT_PX });
  },
});

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
      currentTurn: { type: Boolean, default: false },
      sessionDocs: { type: Array, default: () => [] },
      userId: { type: String, default: "" },
      renderMarkdown: { type: Function, default: null },
      formatTime: { type: Function, default: null },
      formatFileSize: { type: Function, default: null },
      isImageMime: { type: Function, default: null },
      sending: { type: Boolean, default: false },
      deleteMonotonicMessage: { type: Function, default: null },
      resendMonotonicMessage: { type: Function, default: null },
      stopExecution: { type: Function, default: null },
    },
    emits: ["openThinkingDetails"],
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
      activeSession: { sessionId: "s-1", messages: [] },
      shouldRenderMessageInChat: () => true,
      userId: "u-1",
      stopExecution: async () => true,
      fetchExecutionReport: async () => null,
      renderMarkdown: (v) => v,
      formatTime: (v) => String(v || ""),
      formatFileSize: (v) => String(v || ""),
      isImageMime: () => false,
      emptyLogoSrc: "",
      ...props,
    },
    global: {
      plugins: [getActivePinia()],
      ...createElementPlusMountOptions({
        ChatMessageItem: ChatMessageItemStub,
        "chat-message-item": ChatMessageItemStub,
        "el-scrollbar": ScrollbarStub,
        "el-skeleton": defineComponent({
          name: "ElSkeletonStub",
          template: "<div class='el-skeleton-stub'></div>",
        }),
      }),
    },
  });
}

describe("ChatMessageListPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("does not show skeleton when loading detail but messages already exist", () => {
    const wrapper = mountPanel({
      loadingSessionDetail: true,
      activeSession: {
        sessionId: "s-1",
        messages: [{ role: RoleEnum.USER, content: "hello" }],
      },
    });
    expect(wrapper.find(".el-skeleton-stub").exists()).toBe(false);
  });

  it("marks only messages owned by the latest assistant turn as current", () => {
    const projections = [];
    chatMessageItemMock.render = (itemProps) =>
      projections.push({
        turnScopeId: itemProps.messageItem?.turnScopeId,
        currentTurn: itemProps.currentTurn,
      });

    mountPanel(
      {
        activeSession: {
          sessionId: "session-current",
          id: "session-current",
          messages: [
            {
              role: RoleEnum.USER,
              content: "old",
              sessionId: "session-current",
              turnScopeId: "turn-old",
            },
            {
              role: RoleEnum.ASSISTANT,
              content: "old answer",
              sessionId: "session-current",
              turnScopeId: "turn-old",
            },
            {
              role: RoleEnum.USER,
              content: "new",
              sessionId: "session-current",
              turnScopeId: "turn-current",
            },
            {
              role: RoleEnum.ASSISTANT,
              content: "new answer",
              sessionId: "session-current",
              turnScopeId: "turn-current",
            },
          ],
        },
      },
      { preserveChatMessageItemMock: true },
    );

    const assistantProjections = projections.filter((item) =>
      ["turn-old", "turn-current"].includes(item.turnScopeId),
    );
    expect(assistantProjections).toEqual(
      expect.arrayContaining([
        { turnScopeId: "turn-old", currentTurn: false },
        { turnScopeId: "turn-current", currentTurn: true },
      ]),
    );
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
      sessionId: "s-1",
      messages: [{ role: RoleEnum.ASSISTANT, dialogProcessId: "dp-1", content: "v1", ts: 1 }],
    });
    const wrapper = mount(ChatMessageListPanel, {
      props: {
        loadingSessionDetail: false,
        activeSession,
        shouldRenderMessageInChat: () => true,
        userId: "u-1",
        authFetch: null,
        stopExecution: async () => true,
        fetchExecutionReport: async () => null,
        renderMarkdown: (v) => v,
        formatTime: (v) => String(v || ""),
        formatFileSize: (v) => String(v || ""),
        isImageMime: () => false,
        emptyLogoSrc: "",
      },
      global: {
        ...createElementPlusMountOptions({
          "el-scrollbar": ScrollbarStub,
          "el-skeleton": true,
        }),
      },
    });

    expect(counters.mounted).toBe(1);
    expect(counters.unmounted).toBe(0);

    await wrapper.setProps({
      activeSession: {
        sessionId: "s-1",
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
      sessionId: "s-1",
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
        stopExecution: async () => true,
        fetchExecutionReport: async () => null,
        renderMarkdown: (v) => v,
        formatTime: (v) => String(v || ""),
        formatFileSize: (v) => String(v || ""),
        isImageMime: () => false,
        emptyLogoSrc: "",
      },
      global: {
        ...createElementPlusMountOptions({
          "el-scrollbar": ScrollbarStub,
          "el-skeleton": true,
        }),
      },
    });

    expect(counters.mounted).toBe(1);

    await wrapper.setProps({
      activeSession: {
        sessionId: "s-1",
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
    chatMessageItemMock.field = "terminalOutcome";
    chatMessageItemMock.mounted = () => {
      counters.mounted += 1;
    };
    chatMessageItemMock.unmounted = () => {
      counters.unmounted += 1;
    };

    const activeSession = reactive({
      sessionId: "s-1",
      messages: [
        { sessionId: "s-1", role: RoleEnum.USER, content: "old", turnScopeId: "client-turn:old" },
        {
          sessionId: "s-1",
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: "client-turn:old",
          pending: false,
          terminalOutcome: "stopped",
          channelState: { state: "user_stopped", turnScopeId: "client-turn:old" },
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
        stopExecution: async () => true,
        fetchExecutionReport: async () => null,
        renderMarkdown: (v) => v,
        formatTime: (v) => String(v || ""),
        formatFileSize: (v) => String(v || ""),
        isImageMime: () => false,
        emptyLogoSrc: "",
      },
      global: {
        ...createElementPlusMountOptions({
          "el-scrollbar": ScrollbarStub,
          "el-skeleton": true,
        }),
      },
    });

    expect(counters.mounted).toBe(2);
    expect(counters.unmounted).toBe(0);
    expect(wrapper.findAll(".chat-message-item-stub")[1].text()).toBe("stopped");

    await wrapper.setProps({
      activeSession: {
        sessionId: "s-1",
        messages: [
          { sessionId: "s-1", role: RoleEnum.USER, content: "new", turnScopeId: "client-turn:new" },
          {
            sessionId: "s-1",
            role: RoleEnum.ASSISTANT,
            content: "",
            turnScopeId: "client-turn:new",
            pending: true,
            terminalOutcome: "",
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

  it("does not derive message runtime or timing from the global interaction lock", () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const activeSession = {
      id: "s-1",
      sessionId: "s-1",
      messages: [
        { role: RoleEnum.USER, content: "edited orphan", turnScopeId: "turn-live" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial after refresh",
          pending: false,
          turnScopeId: "turn-live",
        },
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
    expect(assistant.pending).toBe(false);
    expect(assistant.channelState).toBeUndefined();
    expect(activeSession.turnTimingsByTurnScopeId).toBeUndefined();
    expect(assistant.thinkingStartedAt).toBeUndefined();
  });

  it("ignores global interaction-lock transitions when projecting message runtime", async () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const activeSession = reactive({
      id: "s-1",
      sessionId: "s-1",
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
    expect(assistant.pending).toBe(false);
    expect(assistant.channelState).toBeUndefined();

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
    expect(assistant.channelState).toBeUndefined();
    expect(activeSession.turnTimingsByTurnScopeId).toBeUndefined();
    expect(assistant.thinkingFinishedAt).toBeUndefined();
  });

  it("does not rewrite message runtime from stale message fields", () => {
    const activeSession = {
      id: "s-1",
      sessionId: "s-1",
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
        {
          role: RoleEnum.ASSISTANT,
          content: "new partial",
          pending: false,
          turnScopeId: "turn-new",
        },
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

    expect(activeSession.messages[1].pending).toBe(true);
    expect(activeSession.messages[1].channelState).toMatchObject({ state: "sending" });
    expect(activeSession.messages[3].pending).toBe(false);
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
        channelState: { state: "user_stopped", turnScopeId: "turn-new" },
      },
    ];

    mountPanel(
      {
        activeSession: {
          sessionId: "s-1",
          messages: renderedMessages,
          rawMessages: staleRawMessages,
        },
      },
      { preserveChatMessageItemMock: true },
    );

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
        sessionId: "s-1",
        messages: [
          {
            role: RoleEnum.USER,
            sessionId: "session-1",
            turnScopeId: "turn-user",
            content: "hello",
          },
          {
            role: RoleEnum.ASSISTANT,
            sessionId: "session-1",
            turnScopeId: "turn-assistant",
            content: "hi",
          },
        ],
      },
    });

    const anchors = wrapper.findAll("[data-chat-message-anchor]");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].attributes("id")).toBe("chat-message-user-session-1--turn-user-0");
    expect(anchors[0].attributes("data-chat-message-anchor")).toBe(
      "chat-message-user-session-1--turn-user-0",
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

describe("ChatMessageListPanel virtual navigation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const messages = [
    { role: RoleEnum.USER, sessionId: "s-1", turnScopeId: "turn-a", content: "a" },
    { role: RoleEnum.ASSISTANT, sessionId: "s-1", turnScopeId: "turn-a", content: "hidden" },
    { role: RoleEnum.USER, sessionId: "s-1", turnScopeId: "turn-b", content: "b" },
  ];

  async function mountVirtualPanel() {
    const wrapper = mountPanel({
      activeSession: { sessionId: "s-1", messages },
      shouldRenderMessageInChat: (item) => item.content !== "hidden",
    });
    const wrap = wrapper.find(".el-scrollbar-stub").element;
    Object.defineProperty(wrap, "scrollHeight", { value: VIEWPORT_HEIGHT_PX * 4 });
    Object.defineProperty(wrap, "clientHeight", { value: VIEWPORT_HEIGHT_PX });
    wrap.scrollTo = vi.fn();
    await nextTick();
    wrap.scrollTo.mockClear();
    return { wrapper, wrap };
  }

  it("scrolls to the rendered index of the anchor with the navigator offset", async () => {
    const { wrapper, wrap } = await mountVirtualPanel();
    const targetAnchorId = wrapper.vm.getMessageAnchorId(messages[2], 2);

    wrapper.vm.scrollToMessageAnchor(targetAnchorId);

    const { messageListEstimatedRowHeightPx, messageAnchorScrollOffsetPx } =
      QUANTITY_THRESHOLDS.client;
    expect(wrap.scrollTo).toHaveBeenCalledWith({
      top: messageListEstimatedRowHeightPx - messageAnchorScrollOffsetPx,
      behavior: "auto",
    });
  });

  it("throws when the anchor is not part of the rendered messages", async () => {
    const { wrapper, wrap } = await mountVirtualPanel();
    const hiddenAnchorId = wrapper.vm.getMessageAnchorId(messages[1], 1);

    expect(() => wrapper.vm.scrollToMessageAnchor(hiddenAnchorId)).toThrow(
      "message anchor is not rendered",
    );
    expect(() => wrapper.vm.scrollToMessageAnchor("")).toThrow(TypeError);
    expect(wrap.scrollTo).not.toHaveBeenCalled();
  });

  it("resolves the current anchor from the virtual scroll offset", async () => {
    const { wrapper } = await mountVirtualPanel();

    expect(wrapper.vm.resolveCurrentMessageAnchorId()).toBe(
      wrapper.vm.getMessageAnchorId(messages[0], 0),
    );
  });

  it("resolves no current anchor when nothing is rendered", () => {
    const wrapper = mountPanel();

    expect(wrapper.vm.resolveCurrentMessageAnchorId()).toBe("");
  });
});
