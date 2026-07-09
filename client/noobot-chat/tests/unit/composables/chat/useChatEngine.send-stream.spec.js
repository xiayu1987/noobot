import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  assistantMessage,
  emitChannelState,
} from "./helpers/useChatEngineHarness";
import { createSessionDetailApplicator } from "../../../../src/composables/chat/chatList/sessionDetailApply";
import { BackendChannelState, FrontendRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.send-stream", () => {
  it("send carries turnScopeId through backend payload and ignores stale unscoped terminal state", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "local-client-turn", "", "sending", {
        turnScopeId: payload.turnScopeId,
      });
      emitChannelState(onEvent, "local-client-turn", "", "completed");
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-client-turn",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(capturedPayload).toEqual(expect.objectContaining({
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(assistant?.turnScopeId).toBe(capturedPayload.turnScopeId);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: BackendChannelState.SENDING,
      dialogProcessId: "",
      turnScopeId: capturedPayload.turnScopeId,
    }));
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("send rejects when frontend run state has no matching in-flight assistant", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, runStateSnapshot, sending, deps, appendMessage } = createHarness({
      sessionId: "local-send-state-mismatch",
      stream,
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old", turnScopeId: "turn-old" },
      {
        role: RoleEnum.ASSISTANT,
        content: "stopped",
        pending: false,
        statusLabel: "chat.stopped",
        turnScopeId: "turn-old",
        channelState: { state: "user_stopped", turnScopeId: "turn-old" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    runStateSnapshot.value = {
      state: BackendChannelState.SENDING,
      sessionId: "local-send-state-mismatch",
      turnScopeId: "turn-missing",
    };

    await expect(engine.send()).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "warning",
      message: "chat.sessionStateOutOfSync",
    }));
  });

  it("ignores another session in-flight run state while sending and finalizing the active session", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.THINKING,
        data: {
          sessionId: "s-active-send",
          dialogProcessId: "dp-active-send",
          event: "tool_call",
          type: "tool_call",
          category: "tool",
          text: "running tool",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "s-active-send",
          dialogProcessId: "dp-active-send",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-active-send",
              content: "done",
            },
          ],
        },
      });
    });
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "done";
      assistant.pending = false;
    });
    const { engine, activeSession, runStateSnapshot, deps } = createHarness({
      sessionId: "s-active-send",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "s-active-send" })),
        applySessionDetail,
      },
    });
    runStateSnapshot.value = {
      state: BackendChannelState.SENDING,
      sessionId: "s-other",
      dialogProcessId: "dp-other",
      turnScopeId: "turn-other",
    };

    const result = await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(result).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      message: "chat.sessionStateOutOfSync",
    }));
    expect(assistant?.realtimeLogs).toEqual([
      expect.objectContaining({ event: "tool_call", text: expect.stringContaining("running tool") }),
    ]);
    expect(runStateSnapshot.value?.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(runStateSnapshot.value?.sessionId).toBe("s-active-send");
  });

  it("accepts active stream events without turnScopeId and still finalizes frontend completion", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.THINKING,
        data: {
          sessionId: "s-missing-turn",
          dialogProcessId: "dp-missing-turn",
          event: "tool_call",
          type: "tool_call",
          category: "tool",
          text: "thinking without frontend turn scope",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "s-missing-turn",
          dialogProcessId: "dp-missing-turn",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-missing-turn",
              content: "final without frontend turn scope",
            },
          ],
        },
      });
    });
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "final without frontend turn scope";
      assistant.pending = false;
    });
    const { engine, activeSession, runStateSnapshot } = createHarness({
      sessionId: "s-missing-turn",
      stream,
      autoPatchStreamTurnScopeId: false,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "s-missing-turn" })),
        applySessionDetail,
      },
    });

    const result = await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(result).toBe(true);
    expect(assistant?.dialogProcessId).toBe("dp-missing-turn");
    expect(assistant?.realtimeLogs).toEqual([
      expect.objectContaining({ text: expect.stringContaining("thinking without frontend turn scope") }),
    ]);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: FrontendRunState.FRONTEND_COMPLETED,
      sessionId: "s-missing-turn",
      dialogProcessId: "dp-missing-turn",
      turnScopeId: assistant?.turnScopeId,
    }));
  });

  it("DONE patches overlay but waits for frontend completion detail while stream promise stays open", async () => {
    let releaseStream;
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-done-open",
          dialogProcessId: "dp-done-open",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done-open", content: "final answer" },
          ],
        },
      });
      await new Promise((resolve) => {
        releaseStream = resolve;
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-done-open",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore detail fetch in this unit test");
        }),
      },
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(true);
    expect(assistant?.statusLabel).not.toBe("chat.generated");
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);

    releaseStream();
    await sendPromise;
  });

  it("DONE patches current assistant turn and promotes session identity without frontend completion", async () => {
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
              attachments: [{ name: "f1" }],
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
    expect(botMessage.channelState).toMatchObject({
      state: BackendChannelState.ERROR,
    });
    expect(sending.value).toBe(false);
  });

  it("channel_state sending preserves thinking elapsed start on assistant message", async () => {
    const messageStartedAt = "2026-06-22T10:00:05.000Z";
    const channelStartedAt = "2026-06-22T10:00:00.000Z";
    const finishedAt = "2026-06-22T10:00:12.000Z";
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-time",
          dialogProcessId: "dp-time",
          state: "sending",
          createdAt: channelStartedAt,
          createdAtMs: Date.parse(channelStartedAt),
          updatedAt: channelStartedAt,
          updatedAtMs: Date.parse(channelStartedAt),
        },
      });
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-time", dialogProcessId: "dp-time", text: "partial" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-time",
          dialogProcessId: "dp-time",
          state: "completed",
          createdAt: channelStartedAt,
          createdAtMs: Date.parse(channelStartedAt),
          updatedAt: finishedAt,
          updatedAtMs: Date.parse(finishedAt),
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: { sessionId: "local-time", dialogProcessId: "dp-time" },
      });
    });
    const { engine, activeSession } = createHarness({ sessionId: "local-time", stream });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(messageStartedAt));
    try {
      await engine.send();
    } finally {
      vi.useRealTimers();
    }

    const assistant = assistantMessage(activeSession);
    expect(assistant?.channelState).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
    });
    expect(assistant?.channelState?.createdAt).toBeUndefined();
    expect(assistant?.channelState?.createdAtMs).toBeUndefined();
    expect(assistant?.thinkingStartedAt).toBe(messageStartedAt);
    expect(assistant?.thinkingFinishedAt).toBe(messageStartedAt);
  });

  it("frontend completion detail apply clears pending and keeps normalized attachments on current assistant", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-frontend-complete",
          dialogProcessId: "dp-frontend-complete",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-frontend-complete",
              content: "overlay answer",
            },
          ],
        },
      });
    });
    const normalizedAttachment = { id: "att-1", name: "result.txt" };
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "normalized answer";
      assistant.attachments = [normalizedAttachment];
      assistant.completedToolLogs = {
        attachments: [{ id: "log-att-1", name: "tool.log" }],
      };
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-frontend-complete",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "local-frontend-complete" })),
        applySessionDetail,
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "local-frontend-complete" }),
      expect.objectContaining({ preserveCurrentMessages: true }),
    );
    expect(assistant?.content).toBe("normalized answer");
    expect(assistant?.attachments).toEqual([normalizedAttachment]);
    expect(assistant?.completedToolLogs?.attachments).toEqual([
      { id: "log-att-1", name: "tool.log" },
    ]);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.channelState).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
    });
    expect(assistant?.statusLabelKey).toBe("chat.generated");
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(runStateSnapshot.value?.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
  });

  it("terminal completed channel_state triggers frontend completion detail without DONE event", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "sending");
      onEvent({
        event: StreamEventEnum.DELTA,
        data: {
          sessionId: "local-channel-complete",
          dialogProcessId: "dp-channel-complete",
          text: "overlay answer",
        },
      });
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "completed");
    });
    const normalizedAttachment = { id: "att-channel", name: "channel-result.txt" };
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "normalized channel answer";
      assistant.attachments = [normalizedAttachment];
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-channel-complete",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "local-channel-complete" })),
        applySessionDetail,
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "local-channel-complete" }),
      expect.objectContaining({ preserveCurrentMessages: true }),
    );
    expect(assistant?.content).toBe("normalized channel answer");
    expect(assistant?.attachments).toEqual([normalizedAttachment]);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.channelState).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
    });
    expect(assistant?.statusLabelKey).toBe("chat.generated");
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(runStateSnapshot.value?.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
  });

  it("channel_state drives assistant status transition", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-2", "dp-state", "sending");
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", text: "partial" },
      });
      emitChannelState(onEvent, "local-2", "dp-state", "user_stopped");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
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

  it("does not refresh current session detail after stopped final event", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-stop-refresh",
      sessions: [
        {
          sessionId: "local-stop-refresh",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-stop-refresh",
              content: "persisted stopped answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stop-refresh", "dp-stop-refresh", "user_stopped", {
        seq: 2,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-stop-refresh", dialogProcessId: "dp-stop-refresh" },
      });
    });
    const { engine, deps } = createHarness({
      sessionId: "local-stop-refresh",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await engine.send();

    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(deps.chatWebSocketClient.isStopRequested).toHaveBeenCalled();
  });

  it("stopped final detail preserves a fresh replacement turn instead of replacing it with a stale stopped snapshot", async () => {
    let replacementTurnScopeId = "";
    const staleStoppedTurnScopeId = "client-turn:old-stopped-detail";
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-stop-detail-preserve",
      sessions: [
        {
          sessionId: "local-stop-detail-preserve",
          messages: [
            { role: RoleEnum.USER, content: "old question", turnScopeId: staleStoppedTurnScopeId },
            {
              role: RoleEnum.ASSISTANT,
              content: "old partial",
              turnScopeId: staleStoppedTurnScopeId,
              statusLabel: "chat.stopped",
              stopState: "user_stopped",
              channelState: { state: "user_stopped", turnScopeId: staleStoppedTurnScopeId },
            },
          ],
        },
      ],
    }));
    const stream = vi.fn(async (payload, onEvent) => {
      replacementTurnScopeId = payload.turnScopeId;
      emitChannelState(onEvent, "local-stop-detail-preserve", "dp-new", "user_stopped", {
        turnScopeId: payload.turnScopeId,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: {
          sessionId: "local-stop-detail-preserve",
          dialogProcessId: "dp-new",
          turnScopeId: payload.turnScopeId,
        },
      });
    });
    const harness = createHarness({
      sessionId: "local-stop-detail-preserve",
      stream,
    });
    const sessions = ref([harness.activeSession.value]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId: harness.activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });
    harness.deps.fetchSessionDetail = fetchSessionDetail;
    harness.deps.applySessionDetail = applySessionDetail;
    harness.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited question", turnScopeId: "client-turn:fresh" },
    ];

    await harness.engine.send({
      content: "edited question",
      turnScopeId: "client-turn:fresh",
      reuseExistingUserTurn: true,
    });

    const messages = harness.activeSession.value.messages;
    expect(replacementTurnScopeId).toBe("client-turn:fresh");
    expect(messages.some((message) => message.turnScopeId === staleStoppedTurnScopeId)).toBe(false);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question", turnScopeId: "client-turn:fresh" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, turnScopeId: "client-turn:fresh" }),
    ]));
  });
});
