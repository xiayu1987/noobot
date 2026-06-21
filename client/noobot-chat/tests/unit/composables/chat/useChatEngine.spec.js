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

const makeSession = (id, overrides = {}) => ({
  id,
  backendSessionId: id,
  title: "chat.newSession",
  loaded: false,
  messages: [],
  rawMessages: [],
  sessionDocs: [],
  connectorPanelState: { selectedConnectors: {} },
  messageCount: 0,
  lastMessage: null,
  updatedAt: "",
  ...overrides,
});

const makeMessage = (role, content = "", attachmentMetas = []) => ({
  role,
  content,
  attachmentMetas,
  pending: false,
  statusLabel: "",
  realtimeLogs: [],
  executionLogTotal: 0,
  tool_calls: [],
});

const createHarness = ({
  sessionId,
  stream,
  pendingInteraction = null,
  interactionSubmittingValue = false,
  deps = {},
} = {}) => {
  const activeSessionId = ref(sessionId);
  const activeSession = ref(makeSession(sessionId));
  const sending = ref(false);
  const input = ref("hello");
  const uploadFiles = ref([]);
  const pendingInteractionRequest = ref(pendingInteraction);
  const interactionSubmitting = ref(interactionSubmittingValue);

  const appendMessage = vi.fn((role, content = "", attachmentMetas = []) => {
    const message = makeMessage(role, content, attachmentMetas);
    activeSession.value.messages.push(message);
    activeSession.value.rawMessages.push(message);
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = message;
    return message;
  });

  const defaultDeps = {
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
    clearPendingInteraction: vi.fn(() => {
      pendingInteractionRequest.value = null;
    }),
    clearPendingInteractionIfObsolete: vi.fn(),
    setPendingInteractionRequest: vi.fn(),
    submitInteractionResponse: vi.fn(),
    refreshSessionsAsync: vi.fn(),
    chatWebSocketClient: {
      stream: stream ?? vi.fn(),
      requestStop: vi.fn(),
      clearLastReceivedSeqMap: vi.fn(),
      dispose: vi.fn(),
      clearStopRequested: vi.fn(),
      isStopRequested: vi.fn(() => false),
    },
    ensureConnected: vi.fn(() => true),
    notify: vi.fn(),
  };

  const resolvedDeps = { ...defaultDeps, ...deps };
  const engine = useChatEngine(resolvedDeps);

  return {
    engine,
    deps: resolvedDeps,
    activeSession,
    activeSessionId,
    sending,
    input,
    uploadFiles,
    pendingInteractionRequest,
    interactionSubmitting,
    appendMessage,
  };
};

const assistantMessage = (activeSession) =>
  activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT);

const emitChannelState = (onEvent, sessionId, dialogProcessId, state, data = {}) => {
  onEvent({
    event: StreamEventEnum.CHANNEL_STATE,
    data: { sessionId, dialogProcessId, state, ...data },
  });
};

describe("useChatEngine", () => {
  it("DONE patches current assistant turn and promotes session identity", async () => {
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
    const { engine, activeSession, activeSessionId, sending } = createHarness({
      sessionId: "local-1",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore detail fetch in this unit test");
        }),
      },
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
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-2", "dp-state", "sending");
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", text: "partial" },
      });
      emitChannelState(onEvent, "local-2", "dp-state", "stopped");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-2", dialogProcessId: "dp-state" },
      });
    });
    const { engine, activeSession, sending } = createHarness({ sessionId: "local-2", stream });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.dialogProcessId).toBe("dp-state");
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("expired channel_state schedules session refresh", async () => {
    vi.useFakeTimers();
    const refreshSessionsAsync = vi.fn(async () => {});
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired", "dp-expired", "expired");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-expired", dialogProcessId: "dp-expired" },
      });
    });
    const { engine, deps } = createHarness({
      sessionId: "local-expired",
      stream,
      pendingInteraction: {
        requestId: "req-1",
        sessionId: "local-expired",
        dialogProcessId: "dp-expired",
      },
      interactionSubmittingValue: true,
      deps: {
        refreshSessionsAsync,
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(refreshSessionsAsync).toHaveBeenCalledTimes(1);
    expect(refreshSessionsAsync).toHaveBeenCalledWith("local-expired", {
      silent: true,
      preserveCurrentMessages: true,
    });
    vi.useRealTimers();
  });

  it("channel_state interaction_pending restores pending interaction payload", async () => {
    const setPendingInteractionRequest = vi.fn();
    const pendingInteraction = {
      requestId: "req-int",
      sessionId: "local-int",
      dialogProcessId: "dp-int",
      interactionType: "confirm",
      content: "confirm?",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int", "dp-int", "interaction_pending", {
        seq: 2,
        pendingInteraction,
      });
      emitChannelState(onEvent, "local-int", "dp-int", "stopped", { seq: 3 });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-int", dialogProcessId: "dp-int" },
      });
    });
    const { engine, interactionSubmitting } = createHarness({
      sessionId: "local-int",
      stream,
      deps: { setPendingInteractionRequest },
    });

    await engine.send();

    expect(setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(setPendingInteractionRequest.mock.calls[0][0]).toMatchObject(pendingInteraction);
    expect(interactionSubmitting.value).toBe(false);
  });

  it("channel_state sending does not clear interaction unless sourceEvent is interaction_response", async () => {
    const clearPendingInteractionIfObsolete = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "interaction_pending", {
        seq: 1,
        pendingInteraction: {
          requestId: "req-int-send",
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          interactionType: "confirm",
          content: "confirm?",
        },
      });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", { seq: 2 });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", {
        sourceEvent: "interaction_response",
        requestId: "req-int-send",
        seq: 3,
      });
    });
    const { engine } = createHarness({
      sessionId: "local-int-send",
      stream,
      deps: { clearPendingInteractionIfObsolete },
    });

    await engine.send();

    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      requestId: "req-int-send",
    });
  });

  it("channel_state stopping/reconnecting updates in-flight status label", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopping");
      emitChannelState(onEvent, "local-flight", "dp-flight", "reconnecting");
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopped");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });
    const { engine, activeSession, sending } = createHarness({
      sessionId: "local-flight",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("channel_state completed/error/no_conversation terminal behaviors are covered", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "completed");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "error");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "no_conversation");
    });
    const { engine, activeSession, sending, interactionSubmitting, deps } = createHarness({
      sessionId: "local-terminal",
      stream,
      pendingInteraction: {
        requestId: "req-terminal",
        sessionId: "local-terminal",
        dialogProcessId: "dp-terminal",
      },
      interactionSubmittingValue: true,
      deps: {
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(interactionSubmitting.value).toBe(false);
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
  });

  it("terminal channel_state with backend sessionId still finalizes current local turn", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "backend-x", "dp-x", "completed", { seq: 2 });
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
    const { engine, activeSession, sending } = createHarness({
      sessionId: "local-x",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore");
        }),
      },
    });

    await engine.send();

    expect(sending.value).toBe(false);
    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
  });

  it("terminal channel_state without DONE still lets send finalize and refresh detail", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-state-only",
      sessions: [
        {
          sessionId: "local-state-only",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-state-only",
              content: "detail answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-state-only", "dp-state-only", "completed", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "local-state-only",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await expect(engine.send()).resolves.toBe(true);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-state-only");
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "local-state-only" }),
      { preserveCurrentMessages: true },
    );
    expect(deps.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(1);
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-missing", "dp-missing", "interaction_pending", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending } = createHarness({
      sessionId: "local-missing",
      stream,
      deps: { notify },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(assistant?.pending).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired-fail", "dp-expired-fail", "expired", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending } = createHarness({
      sessionId: "local-expired-fail",
      stream,
      deps: {
        notify,
        refreshSessionsAsync: vi.fn(async () => false),
      },
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    const assistant = assistantMessage(activeSession);
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
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const refreshSessionConnectorsAsync = vi.fn();
    const upsertConnectedConnectorInPanelState = vi.fn();
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
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-connector-status",
              content: "ok",
            },
          ],
        },
      });
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-connector-status",
      stream,
      deps: {
        refreshSessionConnectorsAsync,
        connectorTypeSet: new Set(["email"]),
        upsertConnectedConnectorInPanelState,
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(activeSession.value, {
      connectorType: "email",
      connectorName: "example_email",
      status: "connected",
    });
    expect(refreshSessionConnectorsAsync).toHaveBeenCalledWith("local-connector-status");
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).not.toHaveBeenCalled();
  });

  it("interaction_request with lifecycle=resolved & ackMode=auto should auto ack and not enter pending", async () => {
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
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
    const { engine } = createHarness({
      sessionId: "local-auto-resolved",
      stream,
      deps: {
        connectorTypeSet: new Set(["email"]),
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).toHaveBeenCalledTimes(1);
    expect(submitInteractionResponse.mock.calls[0][0]).toMatchObject({
      confirmed: true,
      response: "post_action_notice_ack",
    });
  });

  it("prepareMonotonicMessageAction stops first and waits until sending settles", async () => {
    vi.useFakeTimers();
    const { engine, deps, sending, activeSession } = createHarness({
      sessionId: "local-monotonic-stop",
      deps: {
        monotonicActionStopTimeoutMs: 500,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      dialogProcessId: "dp-stop",
    });
    sending.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      setTimeout(onForceStop, 20);
      return true;
    });

    const actionPromise = engine.prepareMonotonicMessageAction();
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30);
    await expect(actionPromise).resolves.toBe(true);
    expect(sending.value).toBe(false);
    vi.useRealTimers();
  });

  it("prepareMonotonicMessageAction warns and rejects when stop does not settle", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const { engine, deps, sending } = createHarness({
      sessionId: "local-monotonic-timeout",
      deps: {
        notify,
        monotonicActionStopTimeoutMs: 30,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    sending.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    const actionPromise = engine.prepareMonotonicMessageAction();
    const rejectionExpectation = expect(actionPromise).rejects.toThrow(
      "chat.monotonicActionStopTimeout",
    );
    await vi.advanceTimersByTimeAsync(40);

    await rejectionExpectation;
    expect(notify).toHaveBeenCalledWith({
      type: "warning",
      message: "chat.monotonicActionStopTimeout",
    });
    expect(sending.value).toBe(true);
    vi.useRealTimers();
  });

  it("cascadeDeleteMessagesFrom resolves assistant target to user message and removes the user turn", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.rawMessages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
    expect(activeSession.value.updatedAt).toBeTruthy();
  });

  it("deleteMonotonicMessage stops before cascading deletion from resolved user message", async () => {
    const { engine, activeSession, sending, deps } = createHarness({ sessionId: "local-delete" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      onForceStop();
      return true;
    });

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage stops, cascades deletion, then sends edited content", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, sending, deps, input } = createHarness({
      sessionId: "local-resend",
      stream,
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      onForceStop();
      return true;
    });

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].message).toBe("edited question");
    expect(activeSession.value.messages[0]).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited question",
    }));
    expect(input.value).toBe("");
  });


  it("deleteMonotonicMessage resolves assistant dialogId to user anchor and applies backend snapshot", async () => {
    const backendSession = makeSession("local-delete-api", {
      messages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      rawMessages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      messageCount: 1,
      version: 3,
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: backendSession,
      deletedCount: 2,
      anchorIndex: 1,
      version: 3,
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { dialogId: "dp-legacy", role: RoleEnum.USER, content: "first" };
    const target = { dialogId: "dp-legacy", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { dialogProcessId: "dp-legacy" },
      expectedVersion: 2,
    }), expect.any(Object));
    expect(applySessionDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-delete-api",
      sessions: [expect.objectContaining({
        sessionId: "local-delete-api",
        messages: backendSession.messages,
      })],
    }), { preserveCurrentMessages: false });
    expect(activeSession.value.messages).toHaveLength(1);
  });

  it("deleteMonotonicMessage does not locally delete when backend returns failure", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 409 }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api-fail",
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(false);

    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("resendMonotonicMessage does not send when backend delete fails", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 404 }));
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-api-fail",
      stream,
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(input.value).toBe("draft before resend");
  });


  it("deleteMonotonicMessage does not delete when stop precondition fails", async () => {
    vi.useFakeTimers();
    const { engine, activeSession, sending } = createHarness({ sessionId: "local-delete-fail" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    const actionPromise = engine.deleteMonotonicMessage(target, { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    vi.useRealTimers();
  });

  it("resendMonotonicMessage does not delete or send when stop precondition fails", async () => {
    vi.useFakeTimers();
    const stream = vi.fn(async () => {});
    const { engine, activeSession, sending, input } = createHarness({ sessionId: "local-resend-fail", stream });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    const actionPromise = engine.resendMonotonicMessage(target, "edited", { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(stream).not.toHaveBeenCalled();
    expect(input.value).toBe("hello");
    vi.useRealTimers();
  });

  it("resendMonotonicMessage rolls back cascade deletion when send fails", async () => {
    const stream = vi.fn(async () => {
      throw new Error("network failed");
    });
    const { engine, activeSession, input } = createHarness({ sessionId: "local-resend-send-fail", stream });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    activeSession.value.updatedAt = "before";
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(activeSession.value.updatedAt).toBe("before");
    expect(input.value).toBe("draft before resend");
  });

});