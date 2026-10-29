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
  createInteractionEnvelope,
  createWorkflowEnvelope,
} from "../helpers/useReconnectReplayHelper.js";
import { availableDetailDocument } from "../../../helpers/sessionDetailFixture.js";
import {
  AGENT_CHANNEL_STATE,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { applyTurnRuntimeEvent } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import {
  INTERACTION_EVENT_TYPE,
  createReplayBatch,
  createTurnSnapshotEnvelope,
} from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleSnapshot, TURN_STATE } from "@noobot/session-protocol";
import { createReconnectControl, createReconnectData } from "@noobot/agent-transport-protocol";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("routes a live child canonical event through the same sub-session reducer as reconnect replay", async () => {
    const { api, mocks } = createFixture();
    const messageEvent = createAuthoritativeMessageEnvelope("tool_call_start", {
      eventId: "evt-child-live-1",
      presentationMessageId: "msg-child-live-1",
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:node-1",
      seq: 1,
      tool: "child-tool",
      toolCallId: "call-child-1",
      args: {},
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      parentSessionId: "s-1",
    }).data;

    const result = await api.applyReconnectEvent(MESSAGE_EVENT_WIRE_EVENT, messageEvent);

    expect(result).toEqual({ applied: true, appliedCount: 1 });
    expect(mocks.reduceSubSessionMessageEvent).toHaveBeenCalledWith(messageEvent);
  });

  it("projects workflow planning events replayed after a page refresh", async () => {
    const { api, mocks } = createFixture();
    const data = createWorkflowEnvelope(
      WORKFLOW_RUNTIME_EVENT.PLANNING,
      {
        dialogProcessId: "dp-workflow",
        workflowRunId: "workflow-1",
        presentationMessageId: "workflow-message-1",
        workflowPayload: {
          title: "workflow",
          nodeSessions: [
            {
              nodeExecutionId: "node-1",
              eventId: "workflow_node_state:workflow-1:node-1:1",
              status: "pending",
              revision: 1,
              sequence: 1,
            },
          ],
        },
      },
      { executionId: "workflow-1" },
    );

    await api.applyReconnectEvent(WORKFLOW_RUNTIME_EVENT.PLANNING, data);

    expect(mocks.applyWorkflowRuntimeEvent).toHaveBeenCalledWith(data, { source: "reconnect" });
  });

  it("EV-02: THINKING updates logs and keeps pending true", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-t" }),
    ];

    await api.applyCanonicalMessageEvent("thinking", {
      sessionId: "s-1",
      dialogProcessId: "dp-t",
      seq: 1,
      text: "thinking",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-t",
    );
    expect(assistant?.pending).toBe(true);
    expect(selectActivityTimelineLogs(assistant)).toHaveLength(1);
  });

  it("EV-01: DELTA appends content and keeps pending unchanged", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-delta" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 1,
      text: "A",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-delta",
    );
    expect(assistant?.content).toBe("AB");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01d: channel_state sending is transport-only", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "turn-cs",
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      turnScopeId: "turn-cs",
      dialogProcessId: "dp-cs",
      state: "sending",
      seq: 11,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01e: channel_state reconnecting is transport-only", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "turn-reconnecting",
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      turnScopeId: "turn-reconnecting",
      dialogProcessId: "",
      state: "reconnecting",
      seq: 12,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01f: turnless channel_state stopping does not guess an assistant or acquire the global lock", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stop", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      state: "stopping",
      seq: 12,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stop",
    );
    expect(refs.sending.value).toBe(false);
    expect(assistant?.terminalOutcome).toBeUndefined();
    expect(assistant?.channelState).toBeUndefined();
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01g: stale terminal channel_state does not clear current local turn scope", async () => {
    const { api, refs } = createFixture();
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "s-1",
      turnScopeId: "client-current",
    });
    applyTurnRuntimeEvent(refs.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "s-1",
      turnScopeId: "client-current",
      state: AGENT_CHANNEL_STATE.SENDING,
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stale",
      state: "completed",
      seq: 99,
    });

    expect(refs.sending.value).toBe(true);
    expect(refs.activeTurnRuntime.value?.turnScopeId).toBe("client-current");
  });

  it("EV-02b: replay in-flight THINKING does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent("message", {
      sessionId: "s-1",
      dialogProcessId: "dp-thinking",
      seq: 1,
      text: "thinking",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01b: reconnect transaction hydrates the active presentation from session authority", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old-q", ts: 1 },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-old",
        content: "old-a",
        ts: 2,
        pending: false,
      },
    ];
    refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];

    mocks.chatList.fetchSessionDetail = vi.fn(async () =>
      availableDetailDocument({
        sessionId: "s-1",
        title: "session-s-1",
        aggregateVersion: 1,
        turnTimings: [],
        messages: [
          {
            messageUid: "u-old",
            role: RoleEnum.USER,
            content: "old-q",
            turnScopeId: "turn-dp-old",
          },
          {
            presentationMessageId: "message-dp-old",
            role: RoleEnum.ASSISTANT,
            turnScopeId: "turn-dp-old",
            dialogProcessId: "dp-old",
            content: "old-a",
          },
          {
            messageUid: "u-new",
            role: RoleEnum.USER,
            content: "new-q",
            turnScopeId: "turn-dp-new",
          },
          createCanonicalAssistant({
            sessionId: "s-1",
            presentationMessageId: "message-dp-new",
            dialogProcessId: "dp-new",
            turnScopeId: "turn-dp-new",
            ts: 4,
          }),
        ],
      }),
    );

    const snapshot = createTurnLifecycleSnapshot({
      generatedAt: "2026-01-01T00:00:00.000Z",
      recentTerminalTurns: [],
      replacedTurns: [],
      unchanged: false,
      recovery: "none",
      commandId: "command-dp-new",
      userId: "admin",
      sessionId: "s-1",
      sequence: 1,
      activeTurnScopeId: "turn-dp-new",
      activeTurn: {
        continuedByTurnScopeId: "",
        userId: "admin",
        sessionId: "s-1",
        turnScopeId: "turn-dp-new",
        presentationMessageId: "message-dp-new",
        dialogProcessId: "dp-new",
        state: TURN_STATE.PROCESSING,
        startedAt: "2026-01-01T00:00:00.000Z",
        executionState: "sending",
        revision: 1,
        sequence: 1,
      },
    });
    const reconnectControl = createReconnectControl({
      requestId: "reconnect-s-1",
      identity: { sessionId: "s-1", parentSessionId: "" },
      knownLifecycleSequenceMap: {},
    });
    await api.applyReconnectData(
      createReconnectData(reconnectControl, [
        {
          sessionId: "s-1",
          replayBatch: createReplayBatch({
            sessionId: "s-1",
            snapshot: createTurnSnapshotEnvelope(snapshot, {
              eventId: "snapshot-command-dp-new",
              producer: { type: "test", id: "use-reconnect-replay" },
            }),
            snapshotSequence: 1,
            events: [],
            pendingInteractions: [],
          }),
        },
      ]),
    );

    const userIdx = refs.activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.USER && message.content === "new-q",
    );
    const assistantIdx = refs.activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-new",
    );
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1", {
      source: "reconnectProtocolReconcile",
    });
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(refs.activeSession.value.messages[assistantIdx]).toMatchObject({
      presentationMessageId: "message-dp-new",
      content: "",
    });
  });

  it("EV-03: INTERACTION_REQUEST sets pending interaction without terminal cleanup", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int", content: "", pending: true },
    ];

    const interaction = createInteractionEnvelope({
      dialogProcessId: "dp-int",
      requestId: "req-1",
      interactionType: "confirm",
    });
    await api.applyReconnectEvent(INTERACTION_EVENT_TYPE.REQUEST, interaction, {
      channelSessionId: "s-1",
    });

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });

  it("EV-03b: non-interaction replay event does not clear interaction without channel_state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int2", content: "", pending: true },
    ];

    const interaction = createInteractionEnvelope({
      dialogProcessId: "dp-int2",
      requestId: "req-2",
      interactionType: "confirm",
    });
    await api.applyReconnectEvent(INTERACTION_EVENT_TYPE.REQUEST, interaction, {
      channelSessionId: "s-1",
    });

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });

  it("EV-03b2: terminal interaction replay clears pending instead of entering it", async () => {
    const { api, mocks } = createFixture();

    const interaction = createInteractionEnvelope({
      dialogProcessId: "dp-int2-auto",
      requestId: "req-2-auto",
      interactionType: "post_action_notice",
      lifecycle: "failed",
      resolvedBy: "system",
    });
    await api.applyReconnectEvent(INTERACTION_EVENT_TYPE.REQUEST, interaction, {
      channelSessionId: "s-1",
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("EV-03c: channel_state completed has no business side effects", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
      turnScopeId: "turn-int3",
      state: "completed",
      seq: 12,
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });

  it("EV-03d: channel_state interaction_pending has no pending-interaction side effects", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      state: "interaction_pending",
      seq: 13,
      pendingInteraction: {
        requestId: "req-4",
        sessionId: "s-1",
        dialogProcessId: "dp-int4",
        interactionType: "confirm",
        content: "need confirm",
      },
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
  });

  it("EV-03e: channel_state sending never clears pending interaction", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      seq: 14,
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      sourceEvent: "interaction_response",
      requestId: "req-int5",
      seq: 15,
    });

    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });
});
