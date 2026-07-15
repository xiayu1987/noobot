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
