/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_COMMAND, AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createCommandResultError } from "../../../../../src/infrastructure/websocket/chatWebSocketProtocol.js";
import { setTransportDiagnosticsLogSink } from "../../../../../src/modules/debug/loggers/transportDiagnosticsLogger.js";
import {
  createHarness,
  assistantMessage,
  emitChannelState,
  emitAuthorityProcessing,
  serverTurnSource,
  emitAuthorityCompletionRequested,
  emitAuthorityTerminal,
} from "../helpers/useChatEngineHarness.js";
import {
  AGENT_CHANNEL_STATE,
  FrontendRunState,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectToolTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectTurnMessageRuntime } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createAuthoritativeMessageEnvelope } from "../helpers/useReconnectReplayHelper.js";

const SEND_REQUEST = Object.freeze({ commandType: AGENT_COMMAND.SEND });

function channelDelivery(transportEvent) {
  return { ...transportEvent, channelSessionId: transportEvent.data.identity.sessionId };
}

describe("useChatEngine.send-stream", () => {
  afterEach(() => setTransportDiagnosticsLogSink(null));

  it("uses one preallocated identity for the local user message and transport payload", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload) => {
      capturedPayload = payload;
    });
    const { engine, activeSession } = createHarness({
      sessionId: "s-user-message-identity",
      stream,
    });

    await engine.send(SEND_REQUEST);

    const userMessage = activeSession.value.messages.find(
      (message) => message.role === RoleEnum.USER,
    );
    expect(userMessage).toEqual(
      expect.objectContaining({
        userMessageId: expect.stringMatching(/^um_/),
        sessionId: "s-user-message-identity",
        turnScopeId: capturedPayload.identity.turnScopeId,
      }),
    );
    expect(capturedPayload.presentation.userMessageId).toBe(userMessage.userMessageId);
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

    await engine.send(SEND_REQUEST);

    expect(capturedPayload.concurrency.expectedTurnRevision).toBe(0);
    expect(capturedPayload.concurrency.expectedAggregateVersion).toBe(7);
  });

  it("retries a stale session version without replacing the local Turn presentation", async () => {
    const conflict = createCommandResultError(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, {
      outcome: "failed",
      error: {
        code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
        message: "session version conflict",
        currentVersion: 2,
      },
    });
    const stream = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
    const applySessionDetail = vi.fn();
    const { engine, activeSession } = createHarness({
      sessionId: "s-version-conflict",
      stream,
      deps: { applySessionDetail },
    });

    await expect(engine.send(SEND_REQUEST)).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(2);
    expect(
      stream.mock.calls.map(([payload]) => payload.concurrency.expectedAggregateVersion),
    ).toEqual([0, 2]);
    expect(stream.mock.calls[1][0].identity).toEqual(stream.mock.calls[0][0].identity);
    expect(activeSession.value.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: RoleEnum.USER,
          messageOrigin: "natural",
        }),
        expect.objectContaining({ role: RoleEnum.ASSISTANT }),
      ]),
    );
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

  it("sends the locally recorded thinking start so refresh can hydrate the duration", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "s-thinking-start", "dp-thinking-start", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-thinking-start"));
      emitAuthorityTerminal(onEvent, {
        ...serverTurnSource(payload, "dp-thinking-start"),
        dialogProcessId: "dp-thinking-start",
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-thinking-start",
      stream,
    });

    await engine.send(SEND_REQUEST);

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
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-server"));
      emitAuthorityTerminal(onEvent, {
        ...serverTurnSource(payload, "dp-server"),
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
        startedAt: thinkingStartedAt,
        finishedAt: thinkingFinishedAt,
        thinkingFinishedAt,
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T13:54:25.940Z"));
    try {
      await engine.send(SEND_REQUEST);
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
      thinkingFinishedAt,
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
      emitChannelState(onEvent, "s-late-completed", "dp-late-completed", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "s-late-completed",
      stream,
    });

    await engine.send(SEND_REQUEST);

    const assistant = assistantMessage(activeSession);
    const runtime = selectTurnMessageRuntime(turnRuntimeRegistry.value, {
      sessionId: "s-late-completed",
      turnScopeId: assistant.turnScopeId,
    });
    expect(runtime).toMatchObject({
      startedAt: expect.any(String),
      finishedAt: "",
    });
  });

  it("send carries turnScopeId through backend payload and ignores stale unscoped terminal state", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "local-client-turn", "", "sending", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, {
        ...serverTurnSource(payload, "dp-server"),
        sessionId: "local-client-turn",
      });
      emitChannelState(onEvent, "local-client-turn", "", "completed");
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-client-turn",
      stream,
    });

    await engine.send(SEND_REQUEST);

    const assistant = assistantMessage(activeSession);
    expect(capturedPayload).toEqual(
      expect.objectContaining({
        identity: {
          sessionId: "local-client-turn",
          turnScopeId: expect.stringMatching(/^client-turn:/),
          parentSessionId: "",
        },
      }),
    );
    expect(assistant?.turnScopeId).toBe(capturedPayload.identity.turnScopeId);
    expect(activeTurnRuntime.value).toEqual(
      expect.objectContaining({
        state: FrontendRunState.PROCESSING,
        backendState: AGENT_CHANNEL_STATE.SENDING,
      }),
    );
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("ignores another session in-flight run state while sending and finalizing the active session", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
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
        applySessionDetail,
      },
    });
    const result = await engine.send(SEND_REQUEST);

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

  it("fails the stream on non-canonical events without turnScopeId and never infers identity from them", async () => {
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
    const { engine, activeSession, sending } = createHarness({
      sessionId: "s-missing-turn",
      stream,
      deps: {
        applySessionDetail,
      },
    });

    const result = await engine.send(SEND_REQUEST);

    const assistant = assistantMessage(activeSession);
    expect(result).toBe(false);
    expect(assistant.dialogProcessId).toBeUndefined();
    expect(selectToolTimelineLogs(assistant)).toEqual([]);
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(sending.value).toBe(true);
  });

  it("stream end without an authoritative terminal keeps the Turn locked", async () => {
    let releaseStream;
    const stream = vi.fn(async () => {
      await new Promise((resolve) => {
        releaseStream = resolve;
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-done-open",
      stream,
    });

    const sendPromise = engine.send(SEND_REQUEST);
    await Promise.resolve();

    const assistant = assistantMessage(activeSession);
    expect(assistant).not.toHaveProperty("pending");
    expect(assistant?.terminalOutcome).not.toBe("generated");
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);

    releaseStream();
    await sendPromise;

    expect(sending.value).toBe(true);
  });

  it("authoritative terminal projects the resolved Turn without promoting Session identity", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      onEvent(
        channelDelivery(
          createAuthoritativeMessageEnvelope("authoritative_final_content", {
            eventId: "evt-final-answer",
            sessionId: "local-1",
            presentationMessageId: payload.presentation.presentationMessageId,
            dialogProcessId: "dp-new",
            turnScopeId: payload.identity.turnScopeId,
            seq: 1,
            text: "final answer",
            modelAlias: "alias-a",
            modelName: "model-a",
            modelRuns: [{ runId: "r1" }],
            attachments: [{ name: "f1" }],
            tool_calls: [{ id: "tc1" }],
          }),
        ),
      );
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-new"));
      emitAuthorityTerminal(onEvent, serverTurnSource(payload, "dp-new"));
    });
    const { engine, deps, activeSession, activeSessionId, sending, activeTurnRuntime } =
      createHarness({
        sessionId: "local-1",
        stream,
      });

    const diagnostics = [];
    setTransportDiagnosticsLogSink({
      isEnabled: (type) => type === "transport-diagnostics",
      debug: (_debugType, factory) => diagnostics.push(factory()) > 0,
    });

    await engine.send(SEND_REQUEST);

    const reductionLog = diagnostics.find(
      (entry) => entry?.event === "frontend.messageEvent.reduced",
    );
    expect(reductionLog).toEqual(
      expect.objectContaining({
        debugType: "transport-diagnostics",
        sessionId: "local-1",
        data: expect.objectContaining({
          presentationMessageId: expect.any(String),
          reductions: [expect.objectContaining({ result: "applied" })],
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
    expect(botMessage).not.toHaveProperty("pending");
    expect(activeTurnRuntime.value).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      terminal: "completed",
    });
    expect(sending.value).toBe(false);

    const turnScopeId = botMessage.turnScopeId;

    await vi.waitFor(() =>
      expect(deps.requestTurnNavigation.mock.calls).toEqual([
        [{ sessionId: "local-1", turnScopeId }],
        [{ sessionId: "local-1", turnScopeId }],
      ]),
    );
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
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-time"));
    });
    const { engine, activeSession, sending, turnRuntimeRegistry } = createHarness({
      sessionId: "local-time",
      stream,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(messageStartedAt));
    try {
      await engine.send(SEND_REQUEST);
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
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-frontend-complete"));
      emitAuthorityTerminal(onEvent, serverTurnSource(payload, "dp-frontend-complete"));
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
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-frontend-complete",
      stream,
      deps: {
        applySessionDetail,
      },
    });

    await engine.send(SEND_REQUEST);

    await vi.waitFor(() => expect(sending.value).toBe(false));
    const assistant = assistantMessage(activeSession);
    expect(applySessionDetail).not.toHaveBeenCalled();

    expect(assistant?.content).toBe("");

    expect(assistant?.attachments).toEqual([]);
    expect(assistant?.completedToolLogs).toBeUndefined();
    expect(assistant).not.toHaveProperty("pending");
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("authoritative message and terminal events complete the Turn while channel_state stays transport-only", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "sending", {
        turnScopeId: payload.identity.turnScopeId,
      });
      onEvent(
        channelDelivery(
          createAuthoritativeMessageEnvelope("authoritative_final_content", {
            eventId: "evt-channel-final-content",
            sessionId: "local-channel-complete",
            presentationMessageId: payload.presentation.presentationMessageId,
            dialogProcessId: "dp-channel-complete",
            turnScopeId: payload.identity.turnScopeId,
            seq: 1,
            text: "overlay answer",
          }),
        ),
      );
      emitChannelState(onEvent, "local-channel-complete", "dp-channel-complete", "completed", {
        turnScopeId: payload.identity.turnScopeId,
      });
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-channel-complete"));
      emitAuthorityCompletionRequested(onEvent, {
        ...serverTurnSource(payload, "dp-channel-complete"),
        dialogProcessId: "dp-channel-complete",
      });
      emitAuthorityTerminal(onEvent, {
        ...serverTurnSource(payload, "dp-channel-complete"),
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
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-channel-complete",
      stream,
      terminalResolutionRevision: 4,
      terminalResolutionSequence: 4,
      deps: {
        applySessionDetail,
      },
    });

    await engine.send(SEND_REQUEST);

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
      emitChannelState(onEvent, "local-2", "dp-state", "user_stopped");
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-state"));
      emitAuthorityTerminal(onEvent, {
        ...serverTurnSource(payload, "dp-state"),
        dialogProcessId: "dp-state",
        state: "stop_completed",
      });
    });
    const { engine, sending, activeTurnRuntime } = createHarness({
      sessionId: "local-2",
      stream,
      terminalResolutionState: "stop_completed",
    });

    await engine.send(SEND_REQUEST);

    await vi.waitFor(() => expect(sending.value).toBe(false));
    expect(activeTurnRuntime.value).toMatchObject({
      dialogProcessId: "dp-state",
      state: FrontendRunState.USER_STOP_COMPLETED,
      terminal: "user_stopped",
    });
    expect(sending.value).toBe(false);
  });

  it("does not apply a session detail after a stopped final event", async () => {
    const applySessionDetail = vi.fn();
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "local-stop-refresh", "dp-stop-refresh", "user_stopped", {
        seq: 2,
      });
      emitAuthorityProcessing(onEvent, serverTurnSource(payload, "dp-stop-refresh"));
      emitAuthorityTerminal(onEvent, {
        ...serverTurnSource(payload, "dp-stop-refresh"),
        dialogProcessId: "dp-stop-refresh",
        state: "stop_completed",
      });
    });
    const { engine } = createHarness({
      sessionId: "local-stop-refresh",
      stream,
      deps: {
        applySessionDetail,
      },
    });

    await engine.send(SEND_REQUEST);

    expect(applySessionDetail).not.toHaveBeenCalled();
  });
});
