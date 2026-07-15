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
      safeConfirm: ref(true),
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

});
