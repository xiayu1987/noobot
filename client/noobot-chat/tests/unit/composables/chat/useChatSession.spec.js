import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref, toRef } from "vue";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { useChatSession } from "../../../../src/composables/chat/useChatSession";
import { logResendDebug, setResendDebugLogSink } from "../../../../src/composables/chat/debug/resendDebugLogger";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  applySessionRunStateEvent,
} from "../../../../src/composables/chat/sessionRunStateMachine";

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

const sessionLogClientMock = vi.hoisted(() => ({
  log: vi.fn(() => true),
  debug: vi.fn(() => true),
  dispose: vi.fn(),
}));

function createSessionFixture(overrides = {}) {
  return {
    id: "s-action-state",
    backendSessionId: "s-action-state",
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
    ...overrides,
  };
}

function createChatSession(options = {}) {
  return useChatSession({
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
    ...options,
  });
}

vi.mock("../../../../src/services/ws/chatWebSocketClient", () => ({
  createChatWebSocketClient: () => wsClientMock,
}));

vi.mock("../../../../src/services/ws/sessionLogWebSocketClient", () => ({
  createSessionLogWebSocketClient: () => sessionLogClientMock,
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
      forceTool: ref(false),
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

    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-state",
        sessions: [],
        messages: [],
      }),
    }));

    const session = useChatSession({
      userId: ref("u-state"),
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
      notify: vi.fn(),
      clearUploadSelection: vi.fn(),
    });

    await session.handleReconnect();

    expect(session.conversationStateSnapshot.value["s-state::dialogProcess:same-id"].state).toBe("sending");
    expect(session.conversationStateSnapshot.value["s-state::turnScope:same-id"].state).toBe("completed");
    expect(authFetch).toHaveBeenCalledWith("/api/internal/session/u-state/s-state");
    expect(Object.keys(session.conversationStateSnapshot.value)).toEqual(
      expect.arrayContaining([
        "s-state::dialogProcess:same-id",
        "s-state::turnScope:same-id",
      ]),
    );
  });

  it("syncs backend stopped conversation state into the run state machine and releases delete gate", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-stopped-sync", backendSessionId: "s-stopped-sync" })];
    store.activeSessionId = "s-stopped-sync";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED, source: "test" },
    });

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-stopped-sync",
          turnScopeId: "turn-stopped-sync",
          dialogProcessId: "dp-stopped-sync",
          state: "user_stopped",
          seq: 2,
        },
      });
    });

    const session = createChatSession();

    expect(session.composerActionState.value.stopRequesting).toBe(true);
    expect(session.composerActionState.value.canDeleteMessage).toBe(false);

    await session.handleReconnect();
    await nextTick();

    expect(store.runStateSnapshot.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(store.runStateSnapshot.backendState).toBe(BackendChannelState.USER_STOPPED);
    expect(store.runStateSnapshot.dialogProcessId).toBe("dp-stopped-sync");
    expect(store.runStateSnapshot.turnScopeId).toBe("turn-stopped-sync");
    expect(store.runStateSnapshot.composerActionState.stopRequesting).toBe(false);
    expect(store.getUserStoppedResumeSnapshot("s-stopped-sync")).toMatchObject({
      sessionId: "s-stopped-sync",
      dialogProcessId: "dp-stopped-sync",
      turnScopeId: "turn-stopped-sync",
      seq: 2,
    });
    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(session.composerActionState.value.awaitingBackendStop).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
  });

  it("remembers complete stopped resume identity when reconnect activates a stopped session", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({ id: "s-active", backendSessionId: "s-active" }),
      createSessionFixture({ id: "s-inactive-stopped", backendSessionId: "s-inactive-stopped" }),
    ];
    store.activeSessionId = "s-active";

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-inactive-stopped",
          turnScopeId: "turn-inactive-stopped",
          dialogProcessId: "dp-inactive-stopped",
          state: BackendChannelState.USER_STOPPED,
          seq: 7,
        },
      });
    });

    const session = createChatSession();
    await session.handleReconnect();
    await nextTick();

    expect(store.runStateSnapshot.sessionId).toBe("s-inactive-stopped");
    expect(store.runStateSnapshot.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(store.runStateSnapshot.backendState).toBe(BackendChannelState.USER_STOPPED);
    expect(store.getUserStoppedResumeSnapshot("s-inactive-stopped")).toMatchObject({
      sessionId: "s-inactive-stopped",
      dialogProcessId: "dp-inactive-stopped",
      turnScopeId: "turn-inactive-stopped",
      seq: 7,
    });
  });

  it("hydrates stopped run state and resume identity from session detail after refresh", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-detail-stopped",
      backendSessionId: "s-detail-stopped",
      loaded: false,
    })];
    store.activeSessionId = "s-detail-stopped";
    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-detail-stopped",
        sessions: [{
          sessionId: "s-detail-stopped",
          turnStatuses: [{
            status: "user_stopped",
            reason: "user_stop",
            description: "用户停止了本轮生成",
            dialogProcessId: "dp-detail-stopped",
            turnScopeId: "turn-detail-stopped",
          }],
          messages: [
            { role: RoleEnum.USER, content: "question", turnScopeId: "turn-detail-stopped" },
            {
              role: RoleEnum.ASSISTANT,
              content: "stopped partial",
              dialogProcessId: "dp-detail-stopped",
              turnScopeId: "turn-detail-stopped",
            },
          ],
        }],
      }),
    }));

    const session = createChatSession({ authFetch });
    await session.selectSession("s-detail-stopped", { force: true });
    await nextTick();

    expect(store.runStateSnapshot).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-detail-stopped",
      dialogProcessId: "dp-detail-stopped",
      turnScopeId: "turn-detail-stopped",
    });
    expect(store.getUserStoppedResumeSnapshot("s-detail-stopped")).toMatchObject({
      sessionId: "s-detail-stopped",
      dialogProcessId: "dp-detail-stopped",
      turnScopeId: "turn-detail-stopped",
      source: "session_detail_user_stopped",
    });
    expect(session.composerActionState.value.userStopped).toBe(true);
  });

  it("clears historical stopped resume identity when completion detail has a newer assistant", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-detail-completed-after-stop",
      backendSessionId: "s-detail-completed-after-stop",
      loaded: false,
    })];
    store.activeSessionId = "s-detail-completed-after-stop";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
      backendState: BackendChannelState.COMPLETED,
      sessionId: "s-detail-completed-after-stop",
      dialogProcessId: "dp-new-completed",
      turnScopeId: "turn-new-completed",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-detail-completed-after-stop",
      dialogProcessId: "dp-old-stopped",
      turnScopeId: "turn-old-stopped",
      seq: 3,
      source: "user_stopped",
    });
    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-detail-completed-after-stop",
        sessions: [{
          sessionId: "s-detail-completed-after-stop",
          messages: [
            { role: RoleEnum.USER, content: "first", turnScopeId: "turn-old-stopped" },
            {
              role: RoleEnum.ASSISTANT,
              content: "stopped partial",
              dialogProcessId: "dp-old-stopped",
              turnScopeId: "turn-old-stopped",
              stopState: "user_stopped",
            },
            { role: RoleEnum.USER, content: "continue", turnScopeId: "turn-new-completed" },
            {
              role: RoleEnum.ASSISTANT,
              content: "completed answer",
              dialogProcessId: "dp-new-completed",
              turnScopeId: "turn-new-completed",
              channelState: { state: "completed" },
            },
          ],
        }],
      }),
    }));

    const session = createChatSession({ authFetch });
    await session.selectSession("s-detail-completed-after-stop", { force: true });
    await nextTick();

    expect(store.getUserStoppedResumeSnapshot("s-detail-completed-after-stop")).toBe(null);
    expect(session.composerActionState.value.userStopped).toBe(false);
  });

  it("keeps send after refresh when a newer persisted turn completed after user stop", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-refresh-completed-after-stop",
      backendSessionId: "s-refresh-completed-after-stop",
      loaded: false,
    })];
    store.activeSessionId = "s-refresh-completed-after-stop";
    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        sessionId: "s-refresh-completed-after-stop",
        sessions: [{
          sessionId: "s-refresh-completed-after-stop",
          turnStatuses: [
            {
              status: "user_stopped",
              dialogProcessId: "dp-old-stopped",
              turnScopeId: "turn-old-stopped",
            },
            {
              status: "completed",
              dialogProcessId: "dp-new-completed",
              turnScopeId: "turn-new-completed",
            },
          ],
          messages: [
            { role: RoleEnum.USER, content: "first", turnScopeId: "turn-old-stopped" },
            {
              role: RoleEnum.ASSISTANT,
              content: "stopped partial",
              dialogProcessId: "dp-old-stopped",
              turnScopeId: "turn-old-stopped",
              stopState: "user_stopped",
            },
            { role: RoleEnum.USER, content: "continue", turnScopeId: "turn-new-completed" },
            {
              role: RoleEnum.ASSISTANT,
              content: "completed answer",
              dialogProcessId: "dp-new-completed",
              turnScopeId: "turn-new-completed",
              channelState: { state: "completed" },
            },
          ],
        }],
      }),
    }));

    const session = createChatSession({ authFetch });
    await session.selectSession("s-refresh-completed-after-stop", { force: true });
    await nextTick();

    expect(store.getUserStoppedResumeSnapshot("s-refresh-completed-after-stop")).toBe(null);
    expect(session.composerActionState.value.userStopped).toBe(false);
  });

  it("clears continue state when the same stopped turn is corrected to completed", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-stop-corrected", backendSessionId: "s-stop-corrected" })];
    store.activeSessionId = "s-stop-corrected";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-stop-corrected",
      dialogProcessId: "dialog-same",
      turnScopeId: "turn-same",
      seq: 7,
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-stop-corrected",
      dialogProcessId: "dialog-same",
      turnScopeId: "turn-same",
      seq: 7,
      source: "user_stopped",
    });
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData?.({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          state: BackendChannelState.COMPLETED,
          sessionId: "s-stop-corrected",
          dialogProcessId: "dialog-same",
          turnScopeId: "turn-same",
          seq: 8,
        },
      });
    });

    const session = createChatSession();
    await session.handleReconnect();
    await nextTick();

    expect(store.getUserStoppedResumeSnapshot("s-stop-corrected")).toBe(null);
    expect(session.composerActionState.value.userStopped).toBe(false);
  });

  it("clears an older stopped resume snapshot when the current different turn completes", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-new-turn-completed", backendSessionId: "s-new-turn-completed" })];
    store.activeSessionId = "s-new-turn-completed";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: BackendChannelState.SENDING,
      backendState: BackendChannelState.SENDING,
      sessionId: "s-new-turn-completed",
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      seq: 20,
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-new-turn-completed",
      dialogProcessId: "dialog-old-stopped",
      turnScopeId: "turn-old-stopped",
      seq: 8,
      source: "user_stopped",
    });
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData?.({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          state: BackendChannelState.COMPLETED,
          sessionId: "s-new-turn-completed",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
          seq: 21,
        },
      });
    });

    const session = createChatSession();
    await session.handleReconnect();
    await nextTick();

    expect(store.getUserStoppedResumeSnapshot("s-new-turn-completed")).toBe(null);
    expect(session.composerActionState.value.userStopped).toBe(false);
    expect(session.composerActionState.value.canStartNewSend).toBe(true);
  });

  it("reconciles stopped resume identity when switching to an already loaded completed session", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({ id: "s-other", backendSessionId: "s-other" }),
      createSessionFixture({
        id: "s-loaded-completed-after-stop",
        backendSessionId: "s-loaded-completed-after-stop",
        loaded: true,
        messages: [
          { role: RoleEnum.USER, content: "first", turnScopeId: "turn-old-stopped" },
          {
            role: RoleEnum.ASSISTANT,
            content: "stopped partial",
            dialogProcessId: "dp-old-stopped",
            turnScopeId: "turn-old-stopped",
            stopState: "user_stopped",
          },
          { role: RoleEnum.USER, content: "next", turnScopeId: "turn-new-completed" },
          {
            role: RoleEnum.ASSISTANT,
            content: "completed answer",
            dialogProcessId: "dp-new-completed",
            turnScopeId: "turn-new-completed",
            channelState: { state: "completed" },
          },
        ],
      }),
    ];
    store.activeSessionId = "s-other";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.FRONTEND_COMPLETED,
      backendState: BackendChannelState.COMPLETED,
      sessionId: "s-other",
      dialogProcessId: "dp-other",
      turnScopeId: "turn-other",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-loaded-completed-after-stop",
      dialogProcessId: "dp-old-stopped",
      turnScopeId: "turn-old-stopped",
      seq: 3,
      source: "user_stopped",
    });
    const authFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, connectors: [] }),
    }));

    const session = createChatSession({ authFetch });
    await session.selectSession("s-loaded-completed-after-stop");
    await nextTick();

    expect(authFetch).not.toHaveBeenCalledWith(
      "/api/internal/session/u-1/s-loaded-completed-after-stop",
    );
    expect(store.getUserStoppedResumeSnapshot("s-loaded-completed-after-stop")).toBe(null);
    expect(session.composerActionState.value.userStopped).toBe(false);
  });

  it("does not re-register stale user_stop replay for an older turn", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-stale-replay", backendSessionId: "s-stale-replay" })];
    store.activeSessionId = "s-stale-replay";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: BackendChannelState.ERROR,
      sessionId: "s-stale-replay",
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
      seq: 0,
    };

    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-stale-replay",
          turnScopeId: "turn-old",
          dialogProcessId: "dp-old",
          state: BackendChannelState.USER_STOPPED,
          seq: 57,
        },
      });
    });

    const session = createChatSession();
    await session.handleReconnect();
    await nextTick();

    expect(store.runStateSnapshot).toMatchObject({
      state: BackendChannelState.ERROR,
      sessionId: "s-stale-replay",
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
    });
    expect(store.getUserStoppedResumeSnapshot("s-stale-replay")).toBe(null);
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

  it("drives send requesting and duplicate-send guard from the session run state machine", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-send-request", backendSessionId: "s-send-request" })];
    store.activeSessionId = "s-send-request";
    store.input = "hello";

    let resolveStream;
    wsClientMock.stream.mockReturnValue(new Promise((resolve) => {
      resolveStream = resolve;
    }));

    const session = createChatSession();

    const firstSend = session.send();
    await nextTick();

    expect(session.composerActionState.value.sendRequesting).toBe(false);
    expect(store.runStateSnapshot.composerActionState.sendRequesting).toBe(false);
    expect(store.runStateSnapshot.state).toBe("sending");
    expect(store.sending).toBe(true);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);

    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, source: "test" },
    });
    await nextTick();

    expect(session.composerActionState.value.sendRequesting).toBe(true);
    const duplicateSend = await session.send();
    expect(duplicateSend).toBe(false);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);

    resolveStream?.({});
    await firstSend;
  });

  it("does not continue when the stopped registry does not match the current stopped turn", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-continue", backendSessionId: "s-continue" })];
    store.activeSessionId = "s-continue";
    store.input = "continue with more context";
    wsClientMock.stream.mockImplementation(async (_payload, _onEvent, options) => {
      options?.onPayloadSent?.(_payload);
      return {};
    });

    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-continue",
      dialogProcessId: "dialog-current-running",
      turnScopeId: "turn-current-running",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-continue",
      dialogProcessId: "dialog-latest-stop",
      turnScopeId: "turn-latest-stop",
      seq: 12,
      source: "user_stopped",
    });

    const session = createChatSession();
    const result = await session.send();

    expect(result).toBe(false);
    expect(wsClientMock.stream).not.toHaveBeenCalled();
    expect(store.getUserStoppedResumeSnapshot("s-continue")).toMatchObject({
      dialogProcessId: "dialog-latest-stop",
      turnScopeId: "turn-latest-stop",
    });
  });

  it("continues from stopped registry when active local id differs from backend session id", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "local-temp-session", backendSessionId: "backend-session-continue" })];
    store.activeSessionId = "local-temp-session";
    store.input = "continue after backend id promotion";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "backend-session-continue",
      dialogProcessId: "dp-stopped-backend",
      turnScopeId: "turn-stopped-backend",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "backend-session-continue",
      dialogProcessId: "dp-stopped-backend",
      turnScopeId: "turn-stopped-backend",
      seq: 8,
      source: "user_stopped",
    });
    wsClientMock.stream.mockImplementation(async (_payload, _onEvent, options) => {
      options?.onPayloadSent?.(_payload);
      return {};
    });

    const session = createChatSession();
    const result = await session.send();

    expect(result).toBe(true);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.sessionId).toBe("backend-session-continue");
    expect(payload.action).toBe("continue");
    expect(payload.config).toMatchObject({
      resumeDialogProcessId: "dp-stopped-backend",
      resumeTurnScopeId: "turn-stopped-backend",
      stoppedTurnScopeId: "turn-stopped-backend",
    });
    expect(store.getUserStoppedResumeSnapshot("backend-session-continue")).toBe(null);
  });

  it("does not let completion from another turn invalidate the current stopped source", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-completed", backendSessionId: "s-completed" })];
    store.activeSessionId = "s-completed";
    store.input = "next message";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-completed",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-completed",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
      seq: 1,
      source: "user_stopped",
    });
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "s-completed",
          dialogProcessId: "dp-completed",
          turnScopeId: "turn-completed",
          state: BackendChannelState.COMPLETED,
          seq: 2,
        },
      });
    });
    wsClientMock.stream.mockImplementation(async () => ({}));

    const session = createChatSession();
    await session.handleReconnect();

    expect(store.getUserStoppedResumeSnapshot("s-completed")).toMatchObject({
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    });
    expect(store.runStateSnapshot).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    });
    expect(wsClientMock.stream).not.toHaveBeenCalled();
  });

  it("does not leak stopped continue state across active sessions", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({ id: "s-stopped-a", backendSessionId: "s-stopped-a" }),
      createSessionFixture({ id: "s-normal-b", backendSessionId: "s-normal-b" }),
    ];
    store.activeSessionId = "s-normal-b";
    store.input = "new message in b";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-stopped-a",
      dialogProcessId: "dp-stopped-a",
      turnScopeId: "turn-stopped-a",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-stopped-a",
      dialogProcessId: "dp-stopped-a",
      turnScopeId: "turn-stopped-a",
      seq: 3,
      source: "user_stopped",
    });
    wsClientMock.stream.mockImplementation(async () => ({}));

    const session = createChatSession();

    expect(session.composerActionState.value.userStopped).toBe(false);
    expect(session.composerActionState.value.canStartNewSend).toBe(true);

    const result = await session.send();

    expect(result).toBe(true);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.sessionId).toBe("s-normal-b");
    expect(payload.action).toBeUndefined();
    expect(payload.config?.resumeDialogProcessId).toBeUndefined();
    expect(payload.config?.resumeTurnScopeId).toBeUndefined();
    expect(store.getUserStoppedResumeSnapshot("s-stopped-a")).toMatchObject({
      dialogProcessId: "dp-stopped-a",
      turnScopeId: "turn-stopped-a",
    });
    expect(session.composerActionState.value.userStopped).toBe(false);
  });

  it("does not project unscoped stopped state as active-session continue state", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-normal", backendSessionId: "s-normal" })];
    store.activeSessionId = "s-normal";
    store.input = "new message";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "",
      dialogProcessId: "dp-unscoped",
      turnScopeId: "turn-unscoped",
    };
    wsClientMock.stream.mockImplementation(async () => ({}));

    const session = createChatSession();

    expect(session.composerActionState.value.userStopped).toBe(false);

    const result = await session.send();

    expect(result).toBe(true);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.sessionId).toBe("s-normal");
    expect(payload.action).toBeUndefined();
    expect(payload.config?.resumeDialogProcessId).toBeUndefined();
    expect(payload.config?.resumeTurnScopeId).toBeUndefined();
  });

  it("restores continue affordance from the active session stopped registry after switching back", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({ id: "s-stopped-a", backendSessionId: "s-stopped-a" }),
      createSessionFixture({ id: "s-normal-b", backendSessionId: "s-normal-b" }),
    ];
    store.activeSessionId = "s-stopped-a";
    store.input = "continue a";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.FRONTEND_COMPLETED,
      backendState: BackendChannelState.COMPLETED,
      sessionId: "s-normal-b",
      dialogProcessId: "dp-done-b",
      turnScopeId: "turn-done-b",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-stopped-a",
      dialogProcessId: "dp-stopped-a",
      turnScopeId: "turn-stopped-a",
      seq: 3,
      source: "user_stopped",
    });
    wsClientMock.stream.mockImplementation(async (_payload, _onEvent, options) => {
      options?.onPayloadSent?.(_payload);
      return {};
    });

    const session = createChatSession();

    expect(session.composerActionState.value.userStopped).toBe(true);

    const result = await session.send();

    expect(result).toBe(true);
    const payload = wsClientMock.stream.mock.calls[0][0];
    expect(payload.sessionId).toBe("s-stopped-a");
    expect(payload.action).toBe("continue");
    expect(payload.config).toMatchObject({
      resumeDialogProcessId: "dp-stopped-a",
      resumeTurnScopeId: "turn-stopped-a",
    });
    expect(store.getUserStoppedResumeSnapshot("s-stopped-a")).toBe(null);
  });

  it("keeps stopped resume registry when continue stream fails before payload is sent", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-continue-fail", backendSessionId: "s-continue-fail" })];
    store.activeSessionId = "s-continue-fail";
    store.input = "continue with more context";
    wsClientMock.stream.mockRejectedValueOnce(new Error("socket not open"));
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-continue-fail",
      dialogProcessId: "dialog-latest-stop",
      turnScopeId: "turn-latest-stop",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-continue-fail",
      dialogProcessId: "dialog-latest-stop",
      turnScopeId: "turn-latest-stop",
      seq: 12,
      source: "user_stopped",
    });

    const session = createChatSession();
    const result = await session.send();

    expect(result).toBe(false);
    expect(wsClientMock.stream).toHaveBeenCalledTimes(1);
    expect(store.getUserStoppedResumeSnapshot("s-continue-fail")).toMatchObject({
      dialogProcessId: "dialog-latest-stop",
      turnScopeId: "turn-latest-stop",
    });
  });

  it("does not continue from a stopped run without a complete registry identity", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-missing-resume", backendSessionId: "s-missing-resume" })];
    store.activeSessionId = "s-missing-resume";
    store.input = "continue with more context";
    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-missing-resume",
      dialogProcessId: "dialog-stale",
      turnScopeId: "turn-stale",
    };

    const session = createChatSession();
    const result = await session.send();

    expect(result).toBe(false);
    expect(wsClientMock.stream).not.toHaveBeenCalled();
  });

  it("drives stop requesting, duplicate-stop guard, and terminal cleanup from the state machine", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-request",
      backendSessionId: "s-stop-request",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop",
          dialogProcessId: "dp-stop",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-request";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: {
        type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
        sessionId: "s-stop-request",
        turnScopeId: "turn-stop",
        source: "test",
      },
    });
    wsClientMock.requestStop.mockReturnValue(true);

    const session = createChatSession();

    const requested = session.stopSending();
    await nextTick();

    expect(requested).toBe(true);
    expect(wsClientMock.requestStop).toHaveBeenCalledTimes(1);
    expect(session.composerActionState.value.stopRequesting).toBe(true);
    expect(store.runStateSnapshot.state).toBe(FrontendRunState.USER_STOP_REQUESTED);

    const duplicateStop = session.stopSending();
    expect(duplicateStop).toBe(false);
    expect(wsClientMock.requestStop).toHaveBeenCalledTimes(1);

    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: {
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state: "user_stopped",
        sessionId: "s-stop-request",
        turnScopeId: "turn-stop",
        dialogProcessId: "dp-stop",
        source: "test",
      },
    });
    await nextTick();

    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(store.runStateSnapshot.composerActionState.stopRequesting).toBe(false);
    expect(store.sending).toBe(false);
    expect(store.canStop).toBe(false);
  });

  it("releases stop gates when stop request sending fails with a backend-style 404/409 error", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-error",
      backendSessionId: "s-stop-error",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop-error" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop-error",
          dialogProcessId: "dp-stop-error",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-error";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: {
        type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
        sessionId: "s-stop-error",
        turnScopeId: "turn-stop-error",
        source: "test",
      },
    });
    const stopError = new Error("conversation not found");
    stopError.response = { status: 404 };
    wsClientMock.requestStop.mockImplementationOnce(() => {
      throw stopError;
    });

    const session = createChatSession();
    const requested = session.stopSending();
    await nextTick();

    expect(requested).toBe(false);
    expect(store.runStateSnapshot.state).toBe("error");
    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(session.composerActionState.value.awaitingBackendStop).toBe(false);
    expect(session.composerActionState.value.canStartNewSend).toBe(true);
    expect(session.composerActionState.value.canRetryMessage).toBe(true);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
    expect(store.sending).toBe(false);
    expect(store.canStop).toBe(false);
  });

  it("releases stop gates when stop request asynchronously rejects with a backend-style 404/409 error", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-async-error",
      backendSessionId: "s-stop-async-error",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop-async-error" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop-async-error",
          dialogProcessId: "dp-stop-async-error",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-async-error";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"),
      sending: toRef(store, "sending"),
      canStop: toRef(store, "canStop"),
      event: {
        type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
        sessionId: "s-stop-async-error",
        turnScopeId: "turn-stop-async-error",
        source: "test",
      },
    });
    const stopError = new Error("conversation conflict");
    stopError.response = { status: 409 };
    wsClientMock.requestStop.mockRejectedValueOnce(stopError);

    const session = createChatSession();
    const requested = await session.stopSending();
    await nextTick();

    expect(requested).toBe(false);
    expect(store.runStateSnapshot.state).toBe("error");
    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(session.composerActionState.value.awaitingBackendStop).toBe(false);
    expect(session.composerActionState.value.canStartNewSend).toBe(true);
    expect(session.composerActionState.value.canRetryMessage).toBe(true);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
    expect(store.sending).toBe(false);
    expect(store.canStop).toBe(false);
  });
});
