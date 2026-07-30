/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthoritativeMessageEnvelope,
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
} from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { selectSessionTurnRuntime } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { selectToolTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import {
  scheduleMissingInteractionPayloadFailure,
} from "../../../../../src/modules/chat/runtime/reconnect/channelStateReplay.js";
import {
  createTurnLifecycleSnapshot,
  TURN_STATE,
} from "@noobot/authoritative-state/contracts";

function createProcessingSnapshot({
  sessionId = "s-1",
  dialogProcessId,
  turnScopeId,
  sequence = 1,
  messageId = `message-${turnScopeId}`,
} = {}) {
  return createTurnLifecycleSnapshot({
    commandId: `snapshot-${turnScopeId}`,
    sessionId,
    sequence,
    activeTurnScopeId: turnScopeId,
    activeTurn: {
      sessionId,
      dialogProcessId,
      turnScopeId,
      messageId,
      presentationMessageId: messageId,
      commandId: `processing-${turnScopeId}`,
      action: "send",
      state: TURN_STATE.PROCESSING,
      phase: "processing",
      executionState: BackendChannelState.SENDING,
      revision: 2,
      sequence,
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("missing interaction payload timeout stays local and does not manufacture an authoritative terminal state", async () => {
    vi.useFakeTimers();
    const sending = { value: true };
    const canStop = { value: true };
    const interactionSubmitting = { value: true };
    const clearPendingInteraction = vi.fn();
    const applyRunStateEvent = vi.fn();
    const notify = vi.fn();
    const targetAssistantMessage = { role: RoleEnum.ASSISTANT, pending: true };

    scheduleMissingInteractionPayloadFailure({
      pendingInteractionRequest: { value: null },
      missingInteractionPayloadTimers: new Map(),
      sessionId: "s-1",
      dialogProcessId: "dp-missing",
      targetAssistantMessage,
      sending,
      canStop,
      applyRunStateEvent,
      interactionSubmitting,
      clearPendingInteraction,
      translate: (key) => key,
      applyAssistantFailureState: vi.fn((message, errorMessage) => {
        message.pending = false;
        message.statusLabel = errorMessage;
      }),
      emitSyntheticErrorConversationState: vi.fn(),
      notify,
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(applyRunStateEvent).not.toHaveBeenCalled();
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(interactionSubmitting.value).toBe(false);
    expect(clearPendingInteraction).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ type: "error", message: "chat.interactionPayloadMissing" });
  });

  it("session scoped reconnect channel_state does not restore elapsed from channel timestamps", async () => {
    const { api, refs, mocks } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "partial from refreshed detail", pending: false },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "sending",
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.pending).toBe(false);
    expect(assistant.channelState).toBeUndefined();
    expect(assistant.thinkingStartedAt).toBeUndefined();
  });

  it("session scoped reconnect channel_state does not use channel timestamps as thinking start", async () => {
    const { api, refs, mocks } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "sending",
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.channelState).toBeUndefined();
    expect(assistant.thinkingStartedAt).toBeUndefined();
  });

  it("reconnect channel_state does not backfill thinking start on active assistant", async () => {
    const { api, refs } = createFixture();
    const startedAt = "2026-06-22T10:00:00.000Z";
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-reconnect-time", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-reconnect-time",
      state: "sending",
      updatedAt: startedAt,
      updatedAtMs: Date.parse(startedAt),
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.channelState).toMatchObject({
      state: BackendChannelState.SENDING,
      sessionId: "s-1",
      dialogProcessId: "dp-reconnect-time",
    });
    expect(assistant.thinkingStartedAt).toBeUndefined();
  });

  it("restores reconnect turn runtime without manufacturing an assistant placeholder", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectData({
      sessions: [{
        sessionId: "s-1",
        hasRunningTask: true,
        currentRun: {
          sessionId: "s-1",
          dialogProcessId: "dp-refresh-running",
          turnScopeId: "turn-refresh-running",
          state: BackendChannelState.SENDING,
          seq: 4,
        },
        turnLifecycleSnapshot: createProcessingSnapshot({
          dialogProcessId: "dp-refresh-running",
          turnScopeId: "turn-refresh-running",
          sequence: 4,
        }),
        conversationStates: [{
          sessionId: "s-1",
          dialogProcessId: "dp-refresh-running",
          turnScopeId: "turn-refresh-running",
          state: BackendChannelState.SENDING,
          seq: 4,
        }],
        dialogProcesses: [],
      }],
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(assistant).toBeUndefined();
    expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1")).toMatchObject({
      sending: true,
      canStop: true,
      turnScopeId: "turn-refresh-running",
    });
  });

  it("keeps currentRun turn identity when refresh replays buffered messages", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({
        sessionId: "s-1",
        messageId: "message-refresh-buffered",
        dialogProcessId: "dp-refresh-buffered",
        turnScopeId: "turn-refresh-buffered",
      }),
    ];

    await api.applyReconnectData({
      sessions: [{
        sessionId: "s-1",
        hasRunningTask: true,
        currentRun: {
          sessionId: "s-1",
          dialogProcessId: "dp-refresh-buffered",
          turnScopeId: "turn-refresh-buffered",
          assistantMessageId: "message-refresh-buffered",
          state: BackendChannelState.SENDING,
          seq: 4,
        },
        dialogProcesses: [{
          dialogProcessId: "dp-refresh-buffered",
          messages: [createAuthoritativeMessageEnvelope("llm_delta", {
            sessionId: "s-1",
            messageId: "message-refresh-buffered",
            dialogProcessId: "dp-refresh-buffered",
            turnScopeId: "turn-refresh-buffered",
            seq: 3,
            text: "partial",
          })],
        }],
      }],
    });

    const assistants = refs.activeSession.value.messages.filter(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      content: "partial",
      pending: true,
      dialogProcessId: "dp-refresh-buffered",
      turnScopeId: "turn-refresh-buffered",
    });
    expect(mocks.applyTurnRuntimeEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "s-1",
          dialogProcessId: "dp-refresh-buffered",
          turnScopeId: "turn-refresh-buffered",
          state: BackendChannelState.SENDING,
        }),
      ]),
    );
  });

  it("does not apply a stale stopped channel_state to a newer resend placeholder", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited", turnScopeId: "client-turn:new" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId: "client-turn:new",
        dialogProcessId: "",
        pending: true,
        channelState: { state: "sending", turnScopeId: "client-turn:new" },
      },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-old",
      turnScopeId: "client-turn:old",
      state: "user_stopped",
      sourceEvent: "stop",
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.pending).toBe(true);
    expect(assistant.statusLabel).toBeUndefined();
    expect(assistant.channelState).toMatchObject({
      state: "sending",
      turnScopeId: "client-turn:new",
    });
  });

  it("projects canonical reconnect thinking without writing process mirrors", async () => {
    const processStore = createFakeProcessStore();
    const { api, refs } = createFixture({ processStore });
    const hydratedLogs = Array.from({ length: 2 }, (_, index) => ({
      event: "tool_call",
      text: `old step ${index + 1}`,
      sequence: index + 1,
    }));
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        ...createCanonicalAssistant({ dialogProcessId: "dp-live" }),
        executionLogTotal: 0,
        processExecutionLogTotal: 2,
        processLastSequence: 2,
        processRealtimeLogs: hydratedLogs,
        processCompletedToolLogs: hydratedLogs,
      },
    ];

    await api.applyCanonicalMessageEvent("thinking", {
      sessionId: "s-1",
      dialogProcessId: "dp-live",
      text: "tool still running",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(processStore.applyEventBatch).not.toHaveBeenCalled();
    expect(selectToolTimelineLogs(assistant)).toHaveLength(0);
    expect(selectActivityTimelineLogs(assistant).some((item) => item.text.includes("tool still running"))).toBe(true);
  });

  it("RT-01: applyReconnectData routes active to replay and non-active to replayCache", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({
        sessionId: "s-1", messageId: "message-a", dialogProcessId: "dp-a", turnScopeId: "turn-a",
      }),
    ];
    refs.sessions.value.find((session) => session.id === "s-2").messages = [
      createCanonicalAssistant({
        sessionId: "s-2", messageId: "message-b", dialogProcessId: "dp-b", turnScopeId: "turn-b",
      }),
    ];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          hasRunningTask: true,
          currentRun: { sessionId: "s-1", dialogProcessId: "dp-a", turnScopeId: "turn-a", state: "sending", seq: 1 },
          dialogProcesses: [
            {
              dialogProcessId: "dp-a",
              messages: [createAuthoritativeMessageEnvelope("llm_delta", {
                sessionId: "s-1", messageId: "message-a", dialogProcessId: "dp-a", turnScopeId: "turn-a", seq: 1, text: "A",
              })],
            },
          ],
        },
        {
          sessionId: "s-2",
          hasRunningTask: true,
          currentRun: { sessionId: "s-2", dialogProcessId: "dp-b", turnScopeId: "turn-b", state: "sending", seq: 1 },
          dialogProcesses: [
            {
              dialogProcessId: "dp-b",
              messages: [createAuthoritativeMessageEnvelope("llm_delta", {
                sessionId: "s-2", messageId: "message-b", dialogProcessId: "dp-b", turnScopeId: "turn-b", seq: 1, text: "B",
              })],
            },
          ],
        },
      ],
    });

    const activeAssistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-a",
    );
    expect(activeAssistant?.content).toBe("A");
    expect(api.__test.replayCache["s-2"]["__turn__s-2::turn-b"]).toHaveLength(1);
  });

  it("RT-03: non-active realtime event writes cache only", async () => {
    const { api, refs, mocks } = createFixture();
    const beforeCount = refs.activeSession.value.messages.length;

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-x",
      seq: 1,
      text: "hello",
    });

    expect(refs.activeSessionId.value).toBe("s-1");
    expect(refs.activeSession.value.messages).toHaveLength(beforeCount);
    expect(api.__test.replayCache["s-2"]["dp-x"]).toHaveLength(1);
    expect(mocks.chatList.selectSession).not.toHaveBeenCalled();
  });

  it("RT-02: active realtime event applies directly and does not write replayCache", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({
        sessionId: "s-1", messageId: "message-active", dialogProcessId: "dp-active", turnScopeId: "turn-active",
      }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-active",
      messageId: "message-active",
      turnScopeId: "turn-active",
      seq: 1,
      text: "hello",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-active",
    );
    expect(assistant?.content).toBe("hello");
    expect(api.__test.replayCache["s-1"]).toBeUndefined();
  });

  it("RT-04: cached events are consumed after session switch without duplicate apply", async () => {
    const { api, refs } = createFixture();
    refs.sessions.value.find((session) => session.id === "s-2").messages = [
      createCanonicalAssistant({
        sessionId: "s-2", messageId: "message-2", dialogProcessId: "dp-2", turnScopeId: "turn-2",
      }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-2",
      dialogProcessId: "dp-2",
      messageId: "message-2",
      turnScopeId: "turn-2",
      seq: 1,
      text: "A",
    });

    refs.activeSessionId.value = "s-2";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-2");

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-2",
      dialogProcessId: "dp-2",
      messageId: "message-2",
      turnScopeId: "turn-2",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-2",
    );
    expect(assistant?.content).toBe("AB");
    expect(api.__test.replayCache["s-2"]).toBeUndefined();
  });

  it("RT-05: reconnect currentRun restores the processing lock and stop action", async () => {
    const { api, refs, mocks } = createFixture();

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-state",
            turnScopeId: "turn-state",
            state: "sending",
            seq: 9,
          },
          turnLifecycleSnapshot: createProcessingSnapshot({
            dialogProcessId: "dp-state",
            turnScopeId: "turn-state",
            sequence: 9,
          }),
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-state",
              state: "sending",
              seq: 9,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1")).toMatchObject({ sending: true, canStop: true });
    expect(mocks.applyTurnLifecycleSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s-1",
        activeTurnScopeId: "turn-state",
      }),
    );
  });

  it("reconciles session detail and retries runtime snapshot when currentRun is invalid", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectData({
      sessions: [{
        sessionId: "s-1",
        hasRunningTask: true,
        conversationStates: [
          { sessionId: "s-1", dialogProcessId: "dp-old", turnScopeId: "turn-old", state: "user_stopped" },
        ],
        dialogProcesses: [],
      }],
    });

    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1", {
      source: "reconnectProtocolReconcile",
    });
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledWith(
      expect.any(Object),
      { preserveCurrentMessages: false, scrollToBottom: false },
    );
    expect(mocks.chatWebSocketClient.reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ currentSessionId: "s-1" }),
    );
  });

  it("EV-03e: connector_status is informational and should not create pending interaction", async () => {
    const { api, refs, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CONNECTOR_STATUS, {
      sessionId: "s-1",
      dialogProcessId: "dp-connector-status",
      connectorType: "email",
      connectorName: "example_email",
      status: "connected",
    });

    expect(mocks.upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(
      refs.activeSession.value,
      {
        connectorType: "email",
        connectorName: "example_email",
        status: "connected",
      },
    );
    expect(mocks.refreshSessionConnectorsAsync).toHaveBeenCalledWith("s-1");
    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
  });

  it("RT-06: expired discovery does not directly clear business interaction state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = true;

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-expired",
            turnScopeId: "turn-expired",
            state: "expired",
            seq: 11,
          },
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-expired",
              state: "expired",
              seq: 11,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1").sending).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(true);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });

  it("RT-06a: backend completed replay only requests authoritative terminal resolution", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-completed",
        turnScopeId: "turn-completed",
        content: "answer",
        pending: true,
        channelState: { state: "sending", dialogProcessId: "dp-completed" },
      },
    ];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-completed",
            turnScopeId: "turn-completed",
            state: "completed",
            seq: 12,
          },
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-completed",
              turnScopeId: "turn-completed",
              state: "completed",
              seq: 12,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledWith("s-1", "turn-completed", {
      commandId: "",
      sequence: 12,
      source: "reconnect_replay",
    });
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
    expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1").sending).toBe(false);
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toMatchObject({ state: "sending" });
    expect(assistant.statusLabelKey).toBeUndefined();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("does not finalize or mutate runtime for an untrusted completed snapshot", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "shared-dialog",
        turnScopeId: "turn-old",
        content: "old answer",
        pending: false,
      },
      { role: RoleEnum.USER, content: "current" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "shared-dialog",
        turnScopeId: "turn-current",
        content: "partial",
        pending: true,
      },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "shared-dialog",
      turnScopeId: "turn-current",
      state: BackendChannelState.COMPLETED,
      authoritativeSnapshot: false,
    });

    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
    expect(refs.activeSession.value.messages[3].pending).toBe(true);
    expect(refs.activeSession.value.messages[1].pending).toBe(false);
    expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1").sending).toBe(false);
    expect(mocks.applyTurnRuntimeEvents).not.toHaveBeenCalled();
  });

  it("repeated authoritative completed notifications remain query triggers and never finalize locally", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "question" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-repeat",
        turnScopeId: "turn-repeat",
        content: "answer",
        pending: true,
      },
    ];
    const terminalFact = {
      sessionId: "s-1",
      dialogProcessId: "dp-repeat",
      turnScopeId: "turn-repeat",
      state: BackendChannelState.COMPLETED,
      seq: 21,
      eventId: "channel-completed-repeat",
      authoritativeSnapshot: true,
    };

    const first = await api.applyChannelState(terminalFact);
    const repeated = await api.applyChannelState(terminalFact);

    expect(first).toMatchObject({ applied: false, reason: "terminal_unresolved" });
    expect(repeated).toMatchObject({ applied: false, reason: "terminal_unresolved" });
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledTimes(2);
    expect(mocks.resolveTurnTerminalState).toHaveBeenNthCalledWith(1, "s-1", "turn-repeat", {
      commandId: "",
      sequence: 21,
      source: "reconnect_replay",
    });
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
    expect(refs.activeSession.value.messages[1].pending).toBe(true);
  });

  it.each(["cancelled"])(
    "RT-06b: %s discovery does not directly clear business interaction state",
    async (state) => {
      const { api, refs, mocks } = createFixture();
      refs.interactionSubmitting.value = true;

      await api.applyReconnectData({
        sessions: [
          {
            sessionId: "s-1",
            currentRun: {
              sessionId: "s-1",
              dialogProcessId: `dp-${state}`,
              turnScopeId: `turn-${state}`,
              state,
              seq: 12,
            },
            conversationStates: [
              {
                sessionId: "s-1",
                dialogProcessId: `dp-${state}`,
                state,
                seq: 12,
              },
            ],
            dialogProcesses: [],
          },
        ],
      });

      expect(selectSessionTurnRuntime(refs.turnRuntimeRegistry.value, "s-1").sending).toBe(false);
      expect(refs.interactionSubmitting.value).toBe(true);
      expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    },
  );
});
