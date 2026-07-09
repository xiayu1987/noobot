import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  assistantMessage,
  emitChannelState,
} from "./helpers/useChatEngineHarness";
import { BackendChannelState, FrontendRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  StreamEventEnum,
  RoleEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.interaction-stop", () => {
  it("expired channel_state schedules session refresh", async () => {
    vi.useFakeTimers();
    const refreshSessionsAsync = vi.fn(async () => {});
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired", "dp-expired", "expired");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
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
      emitChannelState(onEvent, "local-int", "dp-int", "user_stopped", { seq: 3 });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
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
      emitChannelState(onEvent, "local-flight", "dp-flight", "user_stopped");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-flight",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
  });

  it("channel_state stopping keeps in-flight UI but disables repeated stop", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stopping", "dp-stopping", "stopping");
    });
    const { engine, sending, canStop } = createHarness({
      sessionId: "local-stopping",
      stream,
    });

    await engine.send();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
  });

  it("channel_state completed/error/no_conversation terminal behaviors are covered", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "completed");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "error");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "no_conversation");
    });
    const { engine, activeSession, sending, canStop, interactionSubmitting, deps } = createHarness({
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
    expect(canStop.value).toBe(false);
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
    const { engine, activeSession, sending, canStop } = createHarness({
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
    expect(assistant?.channelState?.state).toBe(BackendChannelState.ERROR);
    expect(assistant?.statusLabelKey || assistant?.statusLabel).toBe("chat.failed");
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
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "detail answer";
    });
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
    expect(assistant?.content).toBe("detail answer");
    expect(assistant?.pending).toBe(false);
    expect(assistant?.channelState?.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(assistant?.statusLabelKey).toBe("chat.generated");
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-state-only");
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "local-state-only" }),
      expect.objectContaining({ preserveCurrentMessages: true }),
    );
    expect(deps.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(2);
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-missing", "dp-missing", "interaction_pending", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-missing",
      stream,
      deps: { notify },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(assistant?.pending).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
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
    const { engine, activeSession, sending, canStop } = createHarness({
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
    expect(canStop.value).toBe(false);
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
    const { engine, activeSession, appendMessage } = createHarness({
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

  it("send enables stop while stream is active", async () => {
    let releaseStream;
    const stream = vi.fn(() => new Promise((resolve) => {
      releaseStream = resolve;
    }));
    const { engine, sending, canStop } = createHarness({
      sessionId: "local-active-stop",
      stream,
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);

    releaseStream();
    await sendPromise;
  });

  it("stopSending disables repeated stop and sends stable channel identity payload", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-payload",
    });
    activeSession.value.backendSessionId = "backend-stop-payload";
    activeSession.value.parentSessionId = "parent-session";
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial answer",
      pending: true,
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentDialogProcessId: "parent-dp",
      modelAlias: "alias-a",
      modelName: "model-a",
    });
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(canStop.value).toBe(false);
    expect(engine.stopSending()).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(deps.chatWebSocketClient.requestStop.mock.calls[0][0]).toMatchObject({
      userId: "u-1",
      sessionId: "backend-stop-payload",
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentSessionId: "parent-session",
      parentDialogProcessId: "parent-dp",
      partialAssistant: {
        content: "partial answer",
        dialogProcessId: "dp-stop-payload",
        turnScopeId: "turn-stop-payload",
        modelAlias: "alias-a",
        modelName: "model-a",
      },
    });
  });

  it("stopSending can stop a refreshed in-flight assistant with channelState but no pending flag", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-refreshed",
    });
    activeSession.value.backendSessionId = "backend-stop-refreshed";
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited", turnScopeId: "turn-refreshed" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        channelState: { state: FrontendRunState.RESEND_STREAMING },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-refreshed",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        partialAssistant: expect.objectContaining({
          content: "partial after refresh",
          dialogProcessId: "dp-refreshed",
          turnScopeId: "turn-refreshed",
        }),
      }),
      expect.any(Function),
    );
  });

  it("stopSending can stop a refreshed in-flight assistant when identity only exists in channelState", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-channel-identity",
    });
    activeSession.value.backendSessionId = "backend-stop-channel-identity";
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-channel-identity" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        channelState: {
          state: BackendChannelState.SENDING,
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-channel-identity",
        dialogProcessId: "dp-channel-identity",
        turnScopeId: "turn-channel-identity",
        partialAssistant: expect.objectContaining({
          content: "partial after refresh",
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("stopSending can recover turnScopeId from the latest matching user message after refresh", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-user-turn-fallback",
    });
    activeSession.value.backendSessionId = "backend-stop-user-turn-fallback";
    activeSession.value.messages = [
      {
        role: RoleEnum.USER,
        content: "running",
        dialogProcessId: "dp-user-turn-fallback",
        turnScopeId: "turn-user-fallback",
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: true,
        dialogProcessId: "dp-user-turn-fallback",
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-user-turn-fallback",
        dialogProcessId: "dp-user-turn-fallback",
        turnScopeId: "turn-user-fallback",
        partialAssistant: expect.objectContaining({
          dialogProcessId: "dp-user-turn-fallback",
          turnScopeId: "turn-user-fallback",
        }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("prepareMonotonicMessageAction stops first and waits until sending settles", async () => {
    vi.useFakeTimers();
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-monotonic-stop",
      deps: {
        monotonicActionStopTimeoutMs: 500,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages.push({
      role: RoleEnum.USER,
      content: "question",
      turnScopeId: "turn-stop",
    });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
    });
    sending.value = true;
    canStop.value = true;
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

  it("ignores stale force-stop finalization for a previous turn", () => {
    const { engine, deps, activeSession, sending, canStop } = createHarness({
      sessionId: "local-stale-stop-timeout",
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old question", turnScopeId: "turn-old" },
      {
        role: RoleEnum.ASSISTANT,
        content: "continuing",
        pending: true,
        dialogProcessId: "dp-new",
        turnScopeId: "turn-new",
        channelState: {
          state: BackendChannelState.SENDING,
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
        },
      },
    ];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      onForceStop({
        sessionId: "local-stale-stop-timeout",
        dialogProcessId: "dp-old",
        turnScopeId: "turn-old",
      });
      return true;
    });

    expect(engine.stopSending()).toBe(true);

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(activeSession.value.messages[1]).toMatchObject({
      pending: true,
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
    });
    expect(deps.chatWebSocketClient.dispose).not.toHaveBeenCalled();
  });

  it("prepareMonotonicMessageAction warns and rejects when stop does not settle", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const { engine, deps, activeSession, sending, runStateSnapshot } = createHarness({
      sessionId: "local-monotonic-timeout",
      deps: {
        notify,
        monotonicActionStopTimeoutMs: 30,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-timeout" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: true,
        turnScopeId: "turn-timeout",
        channelState: { state: "sending", turnScopeId: "turn-timeout" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    runStateSnapshot.value = {
      state: BackendChannelState.SENDING,
      sessionId: "local-monotonic-timeout",
      turnScopeId: "turn-timeout",
    };
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

  it("consumes stream ERROR event and refreshes session detail before cleanup", async () => {
    const errorData = {
      error: "invalid tool input",
      sessionId: "s-error",
      dialogProcessId: "dp-error",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({ event: StreamEventEnum.ERROR, data: errorData });
      const error = new Error(errorData.error);
      error.data = errorData;
      throw error;
    });
    const fetchSessionDetail = vi.fn(async (sessionId) => ({ sessionId, messages: [] }));
    const applySessionDetail = vi.fn();
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "s-error",
      stream,
      deps: { fetchSessionDetail, applySessionDetail },
    });

    await expect(engine.send()).resolves.toBe(false);

    const botMessage = assistantMessage(activeSession);
    expect(botMessage.dialogProcessId).toBe("dp-error");
    expect(botMessage.pending).toBe(false);
    expect(botMessage.error).toBe("invalid tool input");
    expect(fetchSessionDetail).toHaveBeenCalledWith("s-error");
    expect(applySessionDetail).toHaveBeenCalledWith({ sessionId: "s-error", messages: [] }, {
      preserveCurrentMessages: true,
      scrollToBottom: false,
    });
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(sending.value).toBe(false);
  });
});
