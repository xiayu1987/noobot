import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatEngine } from "../../../../src/composables/chat/useChatEngine";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: ref("zh-CN"),
    translate: (key) => key,
  }),
}));

describe("useChatEngine", () => {
  it("DONE patches current assistant turn and promotes session identity", async () => {
    const activeSessionId = ref("local-1");
    const activeSession = ref({
      id: "local-1",
      backendSessionId: "local-1",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = {
        role,
        content,
        attachmentMetas,
        pending: false,
        statusLabel: "",
        realtimeLogs: [],
        executionLogTotal: 0,
        tool_calls: [],
      };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      activeSession.value.messageCount = activeSession.value.messages.length;
      activeSession.value.lastMessage = message;
      return message;
    };

    const makeViewMessage = (message) => ({ ...message });
    const foldMessagesForView = (messages) => [...messages];

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { dialogProcessId: "dp-new", text: "partial " },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-1",
          dialogProcessId: "dp-new",
          messages: [
            { role: RoleEnum.USER, content: "old q" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old answer" },
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-new",
              content: "final answer",
              modelAlias: "alias-a",
              modelName: "model-a",
              modelRuns: [{ runId: "r1" }],
              attachmentMetas: [{ name: "f1" }],
              tool_calls: [{ id: "tc1" }],
            },
          ],
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage,
      foldMessagesForView,
      fetchSessionDetail: vi.fn(async () => {
        throw new Error("ignore detail fetch in this unit test");
      }),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    expect(activeSession.value.id).toBe("backend-1");
    expect(activeSession.value.backendSessionId).toBe("backend-1");
    expect(activeSessionId.value).toBe("backend-1");
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[0].role).toBe(RoleEnum.USER);
    const botMessage = activeSession.value.messages[1];
    expect(botMessage.role).toBe(RoleEnum.ASSISTANT);
    expect(botMessage.content).toBe("final answer");
    expect(botMessage.dialogProcessId).toBe("dp-new");
    expect(botMessage.modelAlias).toBe("alias-a");
    expect(botMessage.tool_calls).toEqual([{ id: "tc1" }]);
    expect(botMessage.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("channel_state drives assistant status transition", async () => {
    const activeSessionId = ref("local-2");
    const activeSession = ref({
      id: "local-2",
      backendSessionId: "local-2",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = {
        role,
        content,
        attachmentMetas,
        pending: false,
        statusLabel: "",
        realtimeLogs: [],
        executionLogTotal: 0,
      };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      activeSession.value.messageCount = activeSession.value.messages.length;
      activeSession.value.lastMessage = message;
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", state: "sending" },
      });
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", text: "partial" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", state: "stopped" },
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-2", dialogProcessId: "dp-state" },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    const assistant = activeSession.value.messages.find(
      (messageItem) => messageItem.role === RoleEnum.ASSISTANT,
    );
    expect(assistant?.dialogProcessId).toBe("dp-state");
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("expired channel_state schedules session refresh", async () => {
    vi.useFakeTimers();
    const activeSessionId = ref("local-expired");
    const activeSession = ref({
      id: "local-expired",
      backendSessionId: "local-expired",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref({
      requestId: "req-1",
      sessionId: "local-expired",
      dialogProcessId: "dp-expired",
    });
    const interactionSubmitting = ref(true);
    const refreshSessionsAsync = vi.fn(async () => {});

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = {
        role,
        content,
        attachmentMetas,
        pending: false,
        statusLabel: "",
        realtimeLogs: [],
        executionLogTotal: 0,
      };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      activeSession.value.messageCount = activeSession.value.messages.length;
      activeSession.value.lastMessage = message;
      return message;
    };

    const clearPendingInteraction = vi.fn(() => {
      pendingInteractionRequest.value = null;
    });

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-expired", dialogProcessId: "dp-expired", state: "expired" },
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-expired", dialogProcessId: "dp-expired" },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete: vi.fn(() => true),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync,
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    expect(clearPendingInteraction).toHaveBeenCalled();
    expect(refreshSessionsAsync).toHaveBeenCalledTimes(1);
    expect(refreshSessionsAsync).toHaveBeenCalledWith("local-expired", {
      silent: true,
      preserveCurrentMessages: true,
    });
    vi.useRealTimers();
  });

  it("channel_state interaction_pending restores pending interaction payload", async () => {
    const activeSessionId = ref("local-int");
    const activeSession = ref({
      id: "local-int",
      backendSessionId: "local-int",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const setPendingInteractionRequest = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-int",
          dialogProcessId: "dp-int",
          state: "interaction_pending",
          seq: 2,
          pendingInteraction: {
            requestId: "req-int",
            sessionId: "local-int",
            dialogProcessId: "dp-int",
            interactionType: "confirm",
            content: "confirm?",
          },
        },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-int",
          dialogProcessId: "dp-int",
          state: "stopped",
          seq: 3,
        },
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-int", dialogProcessId: "dp-int" },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest,
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    expect(setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(setPendingInteractionRequest.mock.calls[0][0]).toMatchObject({
      requestId: "req-int",
      sessionId: "local-int",
      dialogProcessId: "dp-int",
      interactionType: "confirm",
      content: "confirm?",
    });
    expect(interactionSubmitting.value).toBe(false);
  });

  it("channel_state sending does not clear interaction unless sourceEvent is interaction_response", async () => {
    const activeSessionId = ref("local-int-send");
    const activeSession = ref({
      id: "local-int-send",
      backendSessionId: "local-int-send",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const clearPendingInteractionIfObsolete = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          state: "interaction_pending",
          seq: 1,
          pendingInteraction: {
            requestId: "req-int-send",
            sessionId: "local-int-send",
            dialogProcessId: "dp-int-send",
            interactionType: "confirm",
            content: "confirm?",
          },
        },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          state: "sending",
          seq: 2,
        },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          state: "sending",
          sourceEvent: "interaction_response",
          seq: 3,
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete,
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "local-int-send",
      dialogProcessId: "dp-int-send",
    });
  });

  it("channel_state stopping/reconnecting updates in-flight status label", async () => {
    const activeSessionId = ref("local-flight");
    const activeSession = ref({
      id: "local-flight",
      backendSessionId: "local-flight",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight", state: "stopping" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight", state: "reconnecting" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight", state: "stopped" },
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    const assistant = activeSession.value.messages.find((m) => m.role === RoleEnum.ASSISTANT);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("channel_state completed/error/no_conversation terminal behaviors are covered", async () => {
    const activeSessionId = ref("local-terminal");
    const activeSession = ref({
      id: "local-terminal",
      backendSessionId: "local-terminal",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref({
      requestId: "req-terminal",
      sessionId: "local-terminal",
      dialogProcessId: "dp-terminal",
    });
    const interactionSubmitting = ref(true);
    const clearPendingInteraction = vi.fn(() => {
      pendingInteractionRequest.value = null;
    });

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-terminal", dialogProcessId: "dp-terminal", state: "completed" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: { sessionId: "local-terminal", dialogProcessId: "dp-terminal", state: "error" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-terminal",
          dialogProcessId: "dp-terminal",
          state: "no_conversation",
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction,
      clearPendingInteractionIfObsolete: vi.fn(() => true),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    const assistant = activeSession.value.messages.find((m) => m.role === RoleEnum.ASSISTANT);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(interactionSubmitting.value).toBe(false);
    expect(clearPendingInteraction).toHaveBeenCalled();
  });

  it("terminal channel_state with backend sessionId still finalizes current local turn", async () => {
    const activeSessionId = ref("local-x");
    const activeSession = ref({
      id: "local-x",
      backendSessionId: "local-x",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "backend-x",
          dialogProcessId: "dp-x",
          state: "completed",
          seq: 2,
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-x",
          dialogProcessId: "dp-x",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-x", content: "ok" },
          ],
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => {
        throw new Error("ignore");
      }),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();
    expect(sending.value).toBe(false);
    const assistant = activeSession.value.messages.find((m) => m.role === RoleEnum.ASSISTANT);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    const activeSessionId = ref("local-missing");
    const activeSession = ref({
      id: "local-missing",
      backendSessionId: "local-missing",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const notify = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-missing",
          dialogProcessId: "dp-missing",
          state: "interaction_pending",
          seq: 2,
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify,
    });

    await engine.send();

    const assistant = activeSession.value.messages.find((m) => m.role === RoleEnum.ASSISTANT);
    expect(sending.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
    const activeSessionId = ref("local-expired-fail");
    const activeSession = ref({
      id: "local-expired-fail",
      backendSessionId: "local-expired-fail",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const notify = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-expired-fail",
          dialogProcessId: "dp-expired-fail",
          state: "expired",
          seq: 2,
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      refreshSessionsAsync: vi.fn(async () => false),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify,
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    const assistant = activeSession.value.messages.find((m) => m.role === RoleEnum.ASSISTANT);
    expect(sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.expiredRefreshFailed");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });

  it("connector_status is informational: updates connector panel without interaction pending", async () => {
    const activeSessionId = ref("local-connector-status");
    const activeSession = ref({
      id: "local-connector-status",
      backendSessionId: "local-connector-status",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const refreshSessionConnectorsAsync = vi.fn();
    const upsertConnectedConnectorInPanelState = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CONNECTOR_STATUS,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          connectorType: "email",
          connectorName: "example_email",
          status: "connected",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-connector-status", content: "ok" },
          ],
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync,
      connectorTypeSet: new Set(["email"]),
      upsertConnectedConnectorInPanelState,
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest,
      submitInteractionResponse,
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    expect(upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(
      activeSession.value,
      {
        connectorType: "email",
        connectorName: "example_email",
        status: "connected",
      },
    );
    expect(refreshSessionConnectorsAsync).toHaveBeenCalledWith("local-connector-status");
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).not.toHaveBeenCalled();
  });

  it("interaction_request with lifecycle=resolved & ackMode=auto should auto ack and not enter pending", async () => {
    const activeSessionId = ref("local-auto-resolved");
    const activeSession = ref({
      id: "local-auto-resolved",
      backendSessionId: "local-auto-resolved",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = { role, content, attachmentMetas, pending: false, statusLabel: "" };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      return message;
    };

    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          requestId: "req-auto",
          interactionType: "post_action_notice",
          lifecycle: "resolved",
          ackMode: "auto",
          content: "done",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-auto", content: "ok" },
          ],
        },
      });
    });

    const engine = useChatEngine({
      userId: ref("u-1"),
      allowUserInteraction: ref(true),
      forceTool: ref(false),
      botScenario: ref(""),
      isImageMime: () => false,
      classifyRealtimeLog: (d) => d,
      scrollBottom: vi.fn(),
      activeSession,
      activeSessionId,
      sending,
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => [...messages],
      fetchSessionDetail: vi.fn(async () => ({})),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(["email"]),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      clearPendingInteractionIfObsolete: vi.fn(),
      setPendingInteractionRequest,
      submitInteractionResponse,
      refreshSessionsAsync: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
    });

    await engine.send();

    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).toHaveBeenCalledTimes(1);
    expect(submitInteractionResponse.mock.calls[0][0]).toMatchObject({
      confirmed: true,
      response: "post_action_notice_ack",
    });
  });
});
