import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";
import { useChatSession } from "../../../../src/composables/chat/useChatSession";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref, toRef } from "vue";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { logResendDebug, setResendDebugLogSink } from "../../../../src/composables/chat/debug/resendDebugLogger";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  applySessionRunStateEvent,
} from "../../../../src/composables/chat/sessionRunStateMachine";
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
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
    setResendDebugLogSink(null);
    vi.unstubAllEnvs();
  });

  it("injects the session log websocket client into resend debug logger", () => {
    createChatSession();
    logResendDebug("resend.injected", {
      sessionId: "s-log",
      dialogProcessId: "dp-log",
      turnScopeId: "ts-log",
      detail: "through-session-log-client",
    });

    expect(sessionLogClientMock.log).toHaveBeenCalledWith(expect.objectContaining({
      category: "debug",
      event: "resend.injected",
      sessionId: "s-log",
      dialogProcessId: "dp-log",
      turnScopeId: "ts-log",
      data: expect.objectContaining({
        phase: "resend.injected",
        detail: "through-session-log-client",
      }),
    }));
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

    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-1",
        sessions: [],
        messages: [
          { role: RoleEnum.USER, content: "old q" },
          { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old keep" },
          { role: RoleEnum.USER, content: "new q" },
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "dp-new",
            content: "new final answer",
            modelAlias: "alias-1",
          },
        ],
      }),
    }));

    const session = useChatSession({
      userId: ref("u-1"),
      apiKey: ref(""),
      allowUserInteraction: ref(true),
      safeConfirm: ref(true),
      botScenario: ref(""),
      connected: ref(true),
      ensureConnected: vi.fn(() => true),
      authFetch,
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
    expect(authFetch).toHaveBeenCalledWith("/api/internal/session/u-1/s-1");
    expect(store.runStateSnapshot).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      lastEventType: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s-1",
      dialogProcessId: "dp-new",
    });
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
      safeConfirm: ref(true),
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
      safeConfirm: ref(true),
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
    expect(sessionLogClientMock.log).toHaveBeenCalledWith(expect.objectContaining({
      category: "system",
      event: "reconnect.failed",
      sessionId: "s-cross-device",
      data: expect.objectContaining({
        event: "reconnect.failed",
        error: "socket reconnect failed",
      }),
    }));
    expect(assistant.pending).toBe(false);
    expect(store.sending).toBe(false);
    expect(store.canStop).toBe(false);
    expect(store.runStateSnapshot.state).toBe("idle");
    expect(session.sending.value).toBe(false);
    expect(session.canStop.value).toBe(false);
  });

});
