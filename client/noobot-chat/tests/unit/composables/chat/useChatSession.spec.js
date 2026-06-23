import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { useChatSession } from "../../../../src/composables/chat/useChatSession";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

const wsClientMock = {
  connect: vi.fn(),
  dispose: vi.fn(),
  sendJson: vi.fn(),
  stream: vi.fn(),
  requestStop: vi.fn(),
  clearLastReceivedSeqMap: vi.fn(),
  clearStopRequested: vi.fn(),
  isStopRequested: vi.fn(() => false),
  reconnect: vi.fn(async () => {}),
};

vi.mock("../../../../src/services/ws/chatWebSocketClient", () => ({
  createChatWebSocketClient: () => wsClientMock,
}));

describe("useChatSession reconnect replay", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.resetChatStore();
    Object.values(wsClientMock).forEach((mockFn) => {
      if (typeof mockFn?.mockReset === "function") mockFn.mockReset();
    });
    wsClientMock.isStopRequested.mockReturnValue(false);
    wsClientMock.reconnect.mockResolvedValue(undefined);
  });

  it("reconnect DONE with dialogProcessId only patches that assistant turn", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-1",
        backendSessionId: "s-1",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [
          { role: RoleEnum.USER, content: "old q" },
          { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old keep" },
          { role: RoleEnum.USER, content: "new q" },
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "dp-new",
            content: "",
            pending: true,
            statusLabel: "",
          },
        ],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 4,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-1";
    store.sending = true;
    store.pendingInteractionRequest = { requestId: "r1" };
    store.interactionSubmitting = true;

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "s-1",
          dialogProcessId: "dp-new",
          messages: [
            { role: RoleEnum.USER, content: "old q" },
            // old answer content changed in snapshot: should not overwrite current turn dp-old.
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-old",
              content: "old overwritten by snapshot",
            },
            { role: RoleEnum.USER, content: "new q" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-new",
              content: "new final answer",
              modelAlias: "alias-1",
            },
          ],
        },
      });
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-1",
          dialogProcessId: "dp-new",
          state: "completed",
          seq: 9,
        },
      });
    });

    const session = useChatSession({
      userId: ref("u-1"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch: null,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    const activeSession = store.sessions[0];
    const oldAssistant = activeSession.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-old",
    );
    const newAssistant = activeSession.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-new",
    );

    expect(oldAssistant.content).toBe("old keep");
    expect(newAssistant.content).toBe("new final answer");
    expect(newAssistant.modelAlias).toBe("alias-1");
    expect(newAssistant.pending).toBe(false);
    expect(store.sending).toBe(false);
    expect(store.pendingInteractionRequest).toBeNull();
    expect(store.interactionSubmitting).toBe(false);
  });


  it("passes current userId to reconnect websocket request", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-reconnect-user",
        backendSessionId: "s-reconnect-user",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 0,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-reconnect-user";

    const session = useChatSession({
      userId: ref("u-reconnect"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch: null,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    expect(wsClientMock.reconnect).toHaveBeenCalledWith(expect.objectContaining({
      currentSessionId: "s-reconnect-user",
      userId: "u-reconnect",
    }));
  });

  it.each([
    ["手机端发消息，PC 端刷新", "mobile-sender", "pc-refresh"],
    ["PC 端发消息，手机端刷新", "pc-sender", "mobile-refresh"],
  ])("%s: reconnect 失败后只提示失败，不强制恢复发送中和停止按钮", async (_label, senderId, refresherId) => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-cross-device",
        backendSessionId: "s-cross-device",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [
          { role: RoleEnum.USER, content: `hello from ${senderId}` },
          { role: RoleEnum.ASSISTANT, content: "", pending: false },
        ],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 2,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-cross-device";
    store.sending = false;
    store.canStop = false;
    wsClientMock.reconnect.mockRejectedValueOnce(new Error("socket reconnect failed"));

    const authFetch = vi.fn();
    const notify = vi.fn();

    const session = useChatSession({
      userId: ref(refresherId),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify,
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    const assistant = store.sessions[0].messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(authFetch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "infra.reconnectFailed" });
    expect(assistant.pending).toBe(false);
    expect(store.sending).toBe(false);
    expect(store.canStop).toBe(false);
    expect(store.runStateSnapshot.state).toBe("idle");
    expect(session.sending.value).toBe(false);
    expect(session.canStop.value).toBe(false);
  });

  it("keeps dialogProcessId and turnScopeId conversation state keys separate", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-state",
        backendSessionId: "s-state",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 0,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-state";

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-state",
          dialogProcessId: "same-id",
          state: "sending",
          seq: 1,
        },
      });
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-state",
          turnScopeId: "same-id",
          state: "completed",
          seq: 2,
        },
      });
    });

    const session = useChatSession({
      userId: ref("u-state"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch: null,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    expect(session.conversationStateSnapshot.value["s-state::dialogProcess:same-id"].state).toBe("sending");
    expect(session.conversationStateSnapshot.value["s-state::turnScope:same-id"].state).toBe("completed");
    expect(Object.keys(session.conversationStateSnapshot.value)).toEqual(
      expect.arrayContaining([
        "s-state::dialogProcess:same-id",
        "s-state::turnScope:same-id",
      ]),
    );
  });

  it("send marks the current turn as stoppable through the session store", async () => {
    const store = useChatStore();
    store.sessions = [
      {
        id: "s-send",
        backendSessionId: "s-send",
        title: "session",
        isLocal: false,
        loaded: true,
        messages: [],
        rawMessages: [],
        sessionDocs: [],
        connectorPanelState: { selectedConnectors: {} },
        currentTaskId: "",
        currentTaskStatus: "idle",
        messageCount: 0,
        lastMessage: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    store.activeSessionId = "s-send";
    store.input = "hello";
    wsClientMock.stream.mockReturnValue(new Promise(() => {}));

    const session = useChatSession({
      userId: ref("u-1"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      streamOutput: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch: null,
      isImageMime: () => false,
      classifyRealtimeLog: (item) => item,
      scrollBottom: vi.fn(),
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    session.send();
    await nextTick();

    expect(store.sending).toBe(true);
    expect(store.canStop).toBe(true);
    expect(store.runStateSnapshot.state).toBe("sending");
    expect(session.sending.value).toBe(true);
    expect(session.canStop.value).toBe(true);
  });
});
