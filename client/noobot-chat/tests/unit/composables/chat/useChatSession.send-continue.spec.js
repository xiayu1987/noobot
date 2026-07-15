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

  it("does not continue and clears the cache when turnStatuses no longer marks the stopped turn as user_stopped", async () => {
    const store = useChatStore();
    store.sessions = [
      createSessionFixture({
        id: "s-pruned",
        backendSessionId: "s-pruned",
        // Authoritative run history: the previously stopped turn advanced to an
        // error state (or was deleted and re-run), so it is no longer resumable.
        turnStatuses: [
          { dialogProcessId: "dialog-stopped", turnScopeId: "turn-stopped", status: "error" },
        ],
      }),
    ];
    store.activeSessionId = "s-pruned";
    store.input = "continue with more context";
    wsClientMock.stream.mockImplementation(async (_payload, _onEvent, options) => {
      options?.onPayloadSent?.(_payload);
      return {};
    });

    store.runStateSnapshot = {
      ...store.runStateSnapshot,
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s-pruned",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
    };
    store.rememberUserStoppedResumeSnapshot({
      sessionId: "s-pruned",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
      seq: 7,
      source: "user_stopped",
    });

    const session = createChatSession();
    const result = await session.send();

    expect(result).toBe(false);
    expect(wsClientMock.stream).not.toHaveBeenCalled();
    expect(store.getUserStoppedResumeSnapshot("s-pruned")).toBe(null);
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

});
