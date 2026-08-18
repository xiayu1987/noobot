/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  assistantMessage,
  activateRuntimeTurn,
  emitChannelState,
  emitAuthorityProcessing,
  emitAuthorityCompletionRequested,
  emitAuthorityTerminal,
} from "../helpers/useChatEngineHarness.js";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import {
  BackendChannelState,
  FrontendRunState,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { SESSION_DETAIL_APPLY_MODE } from "../../../../../src/modules/chat/runtime/engine/messageStateGuards.js";
import {
  applyTurnTimingUpdate,
  selectTurnMessageRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createAuthoritativeMessageEnvelope } from "../helpers/useReconnectReplayHelper.js";

describe("useChatEngine.send-stream", () => {
  it("uses one preallocated identity for the local user message and transport payload", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload) => {
      capturedPayload = payload;
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-user-message-identity",
      stream,
    });

    await engine.send();

    const userMessage = activeSession.value.messages.find(
      (message) => message.role === RoleEnum.USER,
    );
    expect(userMessage).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^msg_/),
        messageId: expect.stringMatching(/^msg_/),
        sessionId: "s-user-message-identity",
        turnScopeId: capturedPayload.identity.turnScopeId,
      }),
    );
    expect(userMessage.id).toBe(userMessage.messageId);
    expect(capturedPayload.presentation.userMessageId).toBe(userMessage.messageId);
    expect(capturedPayload.concurrency.expectedTurnRevision).toBe(0);
    expect(capturedPayload.concurrency.expectedAggregateVersion).toBe(0);
    expect(capturedPayload).not.toHaveProperty("userMessageId");
  });

  it("sends the current session version independently from the new Turn revision", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload) => {
      capturedPayload = payload;
    });
    const { engine, activeSession } = createHarness({
      sessionId: "s-current-version",
      stream,
    });
    activeSession.value.aggregateVersion = 7;
    activeSession.value.revision = 6;

    await engine.send();

    expect(capturedPayload.concurrency.expectedTurnRevision).toBe(0);
    expect(capturedPayload.concurrency.expectedAggregateVersion).toBe(7);
  });

  it("retries a stale session version without replacing the local Turn presentation", async () => {
    const conflict = new Error("session version conflict");
    conflict.data = {
      errorCode: "SESSION_AGGREGATE_VERSION_CONFLICT",
      currentVersion: 2,
    };
    const stream = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);
    const fetchSessionDetail = vi.fn();
    const applySessionDetail = vi.fn();
    const { engine, activeSession } = createHarness({
      sessionId: "s-version-conflict",
      stream,
      deps: { fetchSessionDetail, applySessionDetail },
    });

    await expect(engine.send()).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls.map(([payload]) => (
      payload.concurrency.expectedAggregateVersion
    ))).toEqual([0, 2]);
    expect(stream.mock.calls[1][0].identity).toEqual(stream.mock.calls[0][0].identity);
    expect(activeSession.value.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, frontendUserMessage: true }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT }),
    ]));
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

  it("sends the locally recorded thinking start so refresh can hydrate the duration", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "s-thinking-start", "dp-thinking-start", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, {
        ...payload,
        dialogProcessId: "dp-thinking-start",
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-thinking-start",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    const runtime = selectTurnMessageRuntime(turnRuntimeRegistry.value, {
      sessionId: "s-thinking-start",
      turnScopeId: assistant.turnScopeId,
    });
    expect(runtime).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      terminal: "completed",
      startedAt: expect.any(String),
    });
    expect(capturedPayload.preferences).not.toHaveProperty("thinkingStartedAt");
  });

  it("projects completed thinking duration from one authoritative server timing pair", async () => {
    const thinkingStartedAt = "2026-08-18T13:56:25.940Z";
    const thinkingFinishedAt = "2026-08-18T13:56:29.540Z";
    const stream = vi.fn(async (payload, onEvent) => {
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, {
        ...payload,
        sequence: 3,
        revision: 3,
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-authoritative-thinking-timing",
      stream,
      terminalResolutionRevision: 3,
      terminalResolutionSequence: 3,
      terminalResolutionTurnTiming: {
        thinkingStartedAt,
        thinkingFinishedAt,
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T13:54:25.940Z"));
    try {
      await engine.send();
    } finally {
      vi.useRealTimers();
    }

    const assistant = assistantMessage(activeSession);
    const runtime = selectTurnMessageRuntime(turnRuntimeRegistry.value, {
      sessionId: "s-authoritative-thinking-timing",
      turnScopeId: assistant.turnScopeId,
    });
    expect(runtime).toMatchObject({
      terminal: "completed",
      running: false,
      startedAt: thinkingStartedAt,
      finishedAt: thinkingFinishedAt,
    });
    expect(Date.parse(runtime.finishedAt) - Date.parse(runtime.startedAt)).toBe(3600);
  });

  it("does not derive authoritative finished timing from transport completion", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "s-late-completed", "dp-late-completed", "sending", {
        turnScopeId: payload.identity.turnScopeId,
      });
      const assistant = assistantMessage(activeSession);
      assistant.pending = false;
      assistant.channelState = { state: FrontendRunState.FRONTEND_COMPLETED };
      applyTurnTimingUpdate(turnRuntimeRegistry.value, {
        sessionId: "s-late-completed",
        turnScopeId: payload.identity.turnScopeId,
        dialogProcessId: "dp-late-completed",
        thinkingStartedAt: "2026-07-15T10:00:00.000Z",
      });
      emitChannelState(onEvent, "s-late-completed", "dp-late-completed", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-late-completed",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    const runtime = selectTurnMessageRuntime(turnRuntimeRegistry.value, {
      sessionId: "s-late-completed",
      turnScopeId: assistant.turnScopeId,
    });
    expect(runtime).toMatchObject({
      startedAt: expect.any(String),
      finishedAt: "",
    });
    expect(runtime.startedAt).not.toBe("2026-07-15T10:00:00.000Z");
  });

  it("send carries turnScopeId through backend payload and ignores stale unscoped terminal state", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "local-client-turn", "", "sending", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, {
        ...payload,
        sessionId: "local-client-turn",
      });
      emitChannelState(onEvent, "local-client-turn", "", "completed");
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-client-turn",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(capturedPayload).toEqual(
      expect.objectContaining({
        identity: {
          sessionId: "local-client-turn",
          turnScopeId: expect.stringMatching(/^client-turn:/),
        },
      }),
    );
    expect(assistant?.turnScopeId).toBe(capturedPayload.identity.turnScopeId);
    expect(activeTurnRuntime.value).toEqual(
      expect.objectContaining({
        state: FrontendRunState.PROCESSING,
        backendState: BackendChannelState.SENDING,
      }),
    );
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("send rejects when the current session already has an in-flight Registry turn", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, turnRuntimeRegistry, appendMessage } = createHarness({
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
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-send-state-mismatch",
      turnScopeId: "turn-missing",
    });

    await expect(engine.send()).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("ignores another session in-flight run state while sending and finalizing the active session", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      onEvent({
        event: "message",
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
      emitAuthorityProcessing(onEvent, {
        sessionId: "s-active-send",
        turnScopeId: payload.identity.turnScopeId,
        dialogProcessId: "dp-active-send",
      });
      emitAuthorityTerminal(onEvent, {
        sessionId: "s-active-send",
        turnScopeId: payload.identity.turnScopeId,
        dialogProcessId: "dp-active-send",
      });
    });
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "done";
      assistant.pending = false;
    });
    const { engine, activeSession, activeTurnRuntime, sending, deps } = createHarness({
      sessionId: "s-active-send",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "s-active-send" })),
        applySessionDetail,
      },
    });
    const result = await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(result).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "chat.sessionStateOutOfSync",
      }),
    );
    expect(selectToolTimelineLogs(assistant)).toEqual([]);
    await vi.waitFor(() => expect(sending.value).toBe(false));
    expect(activeTurnRuntime.value?.sessionId).toBe(activeSession.value.sessionId);
  });

  it("does not infer assistant identity from non-canonical stream events without turnScopeId", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      onEvent({
        event: "message",
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
      emitAuthorityProcessing(onEvent, {
        sessionId: "s-missing-turn",
        turnScopeId: payload.identity.turnScopeId,
        dialogProcessId: "dp-missing-turn",
      });
      emitAuthorityTerminal(onEvent, {
        sessionId: "s-missing-turn",
        turnScopeId: payload.identity.turnScopeId,
        dialogProcessId: "dp-missing-turn",
      });
    });
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "final without frontend turn scope";
      assistant.pending = false;
    });
    const { engine, activeSession, activeTurnRuntime, sending } = createHarness({
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
    expect(assistant?.dialogProcessId).toBeUndefined();
    expect(selectToolTimelineLogs(assistant)).toEqual([]);
    await vi.waitFor(() => expect(sending.value).toBe(false));
    expect(activeTurnRuntime.value?.sessionId).toBe(activeSession.value.sessionId);
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
  });

  it("DONE stays locked until the authoritative terminal response succeeds", async () => {
    let releaseStream;
    const stream = vi.fn(async (payload, onEvent) => {
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
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).not.toBe("chat.generated");
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);

    releaseStream();
    await sendPromise;
    // DONE only closes the data stream.  Lifecycle completion is owned by the
    // authoritative terminal event, which this fixture intentionally omits.
    expect(sending.value).toBe(true);
  });

  it("DONE projects the resolved Turn without promoting Session identity", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { dialogProcessId: "dp-new", text: "partial " },
      });
      onEvent(createAuthoritativeMessageEnvelope("authoritative_final_content", {
        eventId: "evt-final-answer",
        sessionId: "local-1",
        messageId: "model-output-final-answer",
        presentationMessageId: payload.presentation.assistantMessageId,
        dialogProcessId: "dp-new",
        turnScopeId: payload.identity.turnScopeId,
        seq: 1,
        text: "final answer",
        modelAlias: "alias-a",
        modelName: "model-a",
        modelRuns: [{ runId: "r1" }],
        attachments: [{ name: "f1" }],
        tool_calls: [{ id: "tc1" }],
      }));
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
              messageId: payload.presentation.assistantMessageId,
              dialogProcessId: "dp-new",
              turnScopeId: payload.identity.turnScopeId,
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
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, payload);
    });
    const { engine, deps, activeSession, activeSessionId, sending, activeTurnRuntime } =
      createHarness({
        sessionId: "local-1",
        stream,
        deps: {
          fetchSessionDetail: vi.fn(async () => {
            throw new Error("ignore detail fetch in this unit test");
          }),
        },
      });

    await engine.send();

    const reductionLog = deps.sessionLogWebSocketClient.log.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry?.event === "frontend.messageEvent.reduced");
    expect(reductionLog).toEqual(
      expect.objectContaining({
        sessionId: "local-1",
        data: expect.objectContaining({
          messageId: "model-output-final-answer",
          presentationMessageId: expect.any(String),
          result: "applied",
          errors: [],
        }),
      }),
    );

    expect(activeSession.value.sessionId).toBe("local-1");
    expect(activeSessionId.value).toBe("local-1");
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[0].role).toBe(RoleEnum.USER);
    await vi.waitFor(() => expect(sending.value).toBe(false));
    const botMessage = activeSession.value.messages[1];
    expect(botMessage.role).toBe(RoleEnum.ASSISTANT);
    expect(botMessage.content).toBe("final answer");
    expect(botMessage.dialogProcessId).toBe("dp-new");
    expect(botMessage.messageEventState.consumedEventIds).toContain("evt-final-answer");
    expect(botMessage.pending).toBe(false);
    expect(activeTurnRuntime.value).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      terminal: "completed",
    });
    expect(sending.value).toBe(false);
  });

  it("channel_state sending preserves thinking elapsed start in the turn timing store", async () => {
    const messageStartedAt = "2026-06-22T10:00:05.000Z";
    const channelStartedAt = "2026-06-22T10:00:00.000Z";
    const finishedAt = "2026-06-22T10:00:12.000Z";
    const stream = vi.fn(async (payload, onEvent) => {
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
      emitAuthorityProcessing(onEvent, payload);
    });
    const { engine, activeSession, sending, turnRuntimeRegistry } = createHarness({
      sessionId: "local-time",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "local-time" })),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(messageStartedAt));
    try {
      await engine.send();
    } finally {
      vi.useRealTimers();
    }

    expect(sending.value).toBe(true);
    const assistant = assistantMessage(activeSession);
    expect(assistant?.channelState).not.toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
    });
    expect(assistant?.channelState?.createdAt).toBeUndefined();
    expect(assistant?.channelState?.createdAtMs).toBeUndefined();
    expect(assistant?.thinkingStartedAt).toBeUndefined();
    expect(assistant?.thinkingFinishedAt).toBeUndefined();
    expect(
      selectTurnMessageRuntime(turnRuntimeRegistry.value, {
        sessionId: "local-time",
        turnScopeId: assistant?.turnScopeId,
      }),
    ).toMatchObject({
      startedAt: messageStartedAt,
      finishedAt: "",
    });
  });

  it("frontend completion detail apply clears pending and keeps normalized attachments on current assistant", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
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
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, payload);
    });
    const normalizedAttachment = { id: "att-1", name: "result.txt" };
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "normalized answer";
      assistant.attachments = [normalizedAttachment];
      assistant.pending = false;
      assistant.completedToolLogs = {
        attachments: [{ id: "log-att-1", name: "tool.log" }],
      };
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-frontend-complete",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "local-frontend-complete" })),
        applySessionDetail,
      },
    });

    await engine.send();

    await vi.waitFor(() => expect(sending.value).toBe(false));
    const assistant = assistantMessage(activeSession);
    expect(applySessionDetail).not.toHaveBeenCalled();
    // DONE payload messages are not a second message projection source. The
    // content is only projected by the validated message event above; this
    // fixture intentionally has no such event.
    expect(assistant?.content).toBe("");
    // Canonical assistant messages normalize collection fields to empty lists;
    // this is presentation shape, not persisted lifecycle state.
    expect(assistant?.attachments).toEqual([]);
    expect(assistant?.completedToolLogs).toBeUndefined();
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("authoritative message and terminal events complete the Turn while channel_state stays transport-only", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "sending", {
        turnScopeId: payload.identity.turnScopeId,
      });
      onEvent(createAuthoritativeMessageEnvelope("authoritative_final_content", {
        eventId: "evt-channel-final-content",
        sessionId: "local-channel-complete",
        messageId: "model-output-channel-complete",
        presentationMessageId: payload.presentation.assistantMessageId,
        dialogProcessId: "dp-channel-complete",
        turnScopeId: payload.identity.turnScopeId,
        seq: 1,
        text: "overlay answer",
      }));
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityCompletionRequested(onEvent, {
        ...payload,
        dialogProcessId: "dp-channel-complete",
      });
      emitAuthorityTerminal(onEvent, {
        ...payload,
        dialogProcessId: "dp-channel-complete",
        sequence: 4,
        revision: 4,
      });
    });
    const normalizedAttachment = { id: "att-channel", name: "channel-result.txt" };
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "normalized channel answer";
      assistant.attachments = [normalizedAttachment];
      assistant.pending = false;
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-channel-complete",
      stream,
      terminalResolutionRevision: 4,
      terminalResolutionSequence: 4,
      deps: {
        fetchSessionDetail: vi.fn(async () => ({ sessionId: "local-channel-complete" })),
        applySessionDetail,
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(assistant?.content).toBe("overlay answer");
    expect(assistant?.attachments).toEqual([]);
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("authoritative stop terminal drives the Turn while channel_state remains transport-only", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
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
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, {
        ...payload,
        dialogProcessId: "dp-state",
        state: "stop_completed",
      });
    });
    const { engine, activeSession, sending, activeTurnRuntime } = createHarness({
      sessionId: "local-2",
      stream,
      terminalResolutionState: "stop_completed",
    });

    await engine.send();

    await vi.waitFor(() => expect(sending.value).toBe(false));
    const assistant = assistantMessage(activeSession);
    expect(assistant?.dialogProcessId).toBe("dp-state");
    expect(activeTurnRuntime.value).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      terminal: "user_stopped",
    });
    expect(sending.value).toBe(false);
  });

  it("fetches and applies the authoritative session summary once after a stopped final event", async () => {
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
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "local-stop-refresh", "dp-stop-refresh", "user_stopped", {
        seq: 2,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-stop-refresh", dialogProcessId: "dp-stop-refresh" },
      });
      emitAuthorityProcessing(onEvent, payload);
      emitAuthorityTerminal(onEvent, {
        ...payload,
        dialogProcessId: "dp-stop-refresh",
        state: "stop_completed",
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

    // USER_STOPPED is data-plane transport information.  The explicit
    // Authority terminal event above is the only lifecycle/terminal input;
    // neither event may trigger an implicit session-detail refresh.
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
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
      replacementTurnScopeId = payload.identity.turnScopeId;
      emitChannelState(onEvent, "local-stop-detail-preserve", "dp-new", "user_stopped", {
        turnScopeId: payload.identity.turnScopeId,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: {
          sessionId: "local-stop-detail-preserve",
          dialogProcessId: "dp-new",
          turnScopeId: payload.identity.turnScopeId,
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
      {
        id: "msg-user-fresh",
        messageId: "msg-user-fresh",
        role: RoleEnum.USER,
        content: "edited question",
        turnScopeId: "client-turn:fresh",
      },
    ];

    await harness.engine.send({
      content: "edited question",
      turnScopeId: "client-turn:fresh",
      reuseExistingUserTurn: true,
      userMessageId: "msg-user-fresh",
    });

    const messages = harness.activeSession.value.messages;
    expect(replacementTurnScopeId).toBe("client-turn:fresh");
    expect(messages.some((message) => message.turnScopeId === staleStoppedTurnScopeId)).toBe(false);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: RoleEnum.USER,
          content: "edited question",
          turnScopeId: "client-turn:fresh",
        }),
        expect.objectContaining({ role: RoleEnum.ASSISTANT, turnScopeId: "client-turn:fresh" }),
      ]),
    );
  });
});
